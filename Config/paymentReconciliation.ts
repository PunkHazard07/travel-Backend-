import Booking from "../Model/booking.js";
import type { PaymentAttemptDocument } from "../Model/paymentAttempt.js";
import { paystackService } from "./paystackService.js";
import { paymentAttemptService } from "./paymentAttemptService.js";
import { settleAttemptPayment, toOutcomeInput, type VerifiedPayment } from "./paymentSettlement.js";
import {
    ATTEMPT_RECHECK_INTERVAL_MS,
    INITIATING_ATTEMPT_MAX_AGE_MS,
    RECONCILE_BATCH_SIZE,
    RECONCILE_INTERVAL_MS,
    isInitiatingAttemptStale,
    isPendingAttemptExpired,
} from "../utils/paymentAttemptPolicy.js";

export type ReconcileAction =
    | "skipped"                  // nothing to do yet
    | "settled"                  // Paystack says paid: booking settled, attempt recorded
    | "closed_failed"            // attempt closed as failed
    | "expired"                  // unpaid past our limit: closed so a new attempt is allowed
    | "still_pending"            // still open, not old enough to close
    | "needs_review"             // unknown / reversed: left for a person
    | "verification_unavailable" // Paystack couldn't be reached: nothing changed
    | "error";

export type ReconcileSummary = {
    checked: number;
    counts: Record<ReconcileAction, number>;
};

const emptyCounts = (): Record<ReconcileAction, number> => ({
    skipped: 0,
    settled: 0,
    closed_failed: 0,
    expired: 0,
    still_pending: 0,
    needs_review: 0,
    verification_unavailable: 0,
    error: 0,
});

// Handles ONE attempt. Never closes anything it could not check first.
export const reconcileAttempt = async (attempt: PaymentAttemptDocument, now: Date = new Date()): Promise<ReconcileAction> => {
    //The customer was never given a link, so nobody can pay this one. Safe to close.
    if (attempt.status === "initiating") {
        if (!isInitiatingAttemptStale(attempt, now)) return "skipped";
        await paymentAttemptService.markInitializationFailed(attempt._id, "stale_initiating");
        return "closed_failed";
    }

    //pending or unknown: ask Paystack first.
    let verification: VerifiedPayment;
    try {
        verification = await paystackService.verifyPayment(attempt.reference);
    } catch (verifyError) {
        console.error(`Reconcile: could not verify ${attempt.reference}:`, verifyError);
        // Note that we looked (so we don't hammer Paystack), but change no status.
        await paymentAttemptService.recordOutcome(attempt.reference, { providerStatus: null }, "reconcile");
        return "verification_unavailable";
    }

    if (verification.success) {
        const booking = await Booking.findById(attempt.bookingId);
        if (!booking) {
            // Money arrived for a booking that no longer exists: record it, flag for a person.
            console.error(`Reconcile: attempt ${attempt.reference} was paid but booking ${attempt.bookingId} is missing`);
            await paymentAttemptService.recordOutcome(attempt.reference, toOutcomeInput(verification), "reconcile");
            await paymentAttemptService.flagDuplicatePayment(attempt._id);
            return "needs_review";
        }
        await settleAttemptPayment(booking, attempt, verification, "reconcile");
        return "settled";
    }

    const outcome = await paymentAttemptService.recordOutcome(attempt.reference, toOutcomeInput(verification), "reconcile");
    const current = outcome.attempt;

    if (!current) return "skipped";
    if (current.status === "failed") return "closed_failed";
    if (current.status === "unknown") return "needs_review";
    if (current.status === "success") return "settled";
    if (current.status === "expired") return "expired";

    // Still open at Paystack. Only now, and only because Paystack said "not paid",
    // do we close it if it is past our time limit.
    if (current.status === "pending" && isPendingAttemptExpired(current, now)) {
        const expired = await paymentAttemptService.expire(current._id);
        return expired ? "expired" : "skipped";
    }

    return "still_pending";
};

export const reconcileStaleAttempts = async (now: Date = new Date()): Promise<ReconcileSummary> => {
    const attempts = await paymentAttemptService.findStaleAttempts({
        initiatingBefore: new Date(now.getTime() - INITIATING_ATTEMPT_MAX_AGE_MS),
        recheckBefore: new Date(now.getTime() - ATTEMPT_RECHECK_INTERVAL_MS),
        limit: RECONCILE_BATCH_SIZE,
    });

    const counts = emptyCounts();

    for (const attempt of attempts) {
        try {
            counts[await reconcileAttempt(attempt, now)] += 1;
        } catch (error) {
            console.error(`Reconcile: unexpected error on attempt ${attempt.reference}:`, error);
            counts.error += 1;
        }
    }

    return { checked: attempts.length, counts };
};

let reconcileTimer: NodeJS.Timeout | null = null;
let running = false;

export const startPaymentReconciliationSchedule = (): void => {
    if (reconcileTimer) return;

    reconcileTimer = setInterval(() => {
        if (running) return;
        running = true;

        reconcileStaleAttempts()
            .then((summary) => {
                if (summary.checked > 0) {
                    console.log("Payment reconciliation:", JSON.stringify(summary));
                }
            })
            .catch((error: Error) => {
                console.error("Payment reconciliation pass failed:", error.message);
            })
            .finally(() => {
                running = false;
            });
    }, RECONCILE_INTERVAL_MS);

    // Never keep the process alive just for this timer.
    reconcileTimer.unref();
};

export const stopPaymentReconciliationSchedule = (): void => {
    if (reconcileTimer) {
        clearInterval(reconcileTimer);
        reconcileTimer = null;
    }
};