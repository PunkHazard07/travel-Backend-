import Booking from "../Model/booking.js";
import type { PaymentAttemptDocument } from "../Model/paymentAttempt.js";
import { paystackService } from "./paystackService.js";
import { paymentAttemptService } from "./paymentAttemptService.js";
import { settleAttemptPayment, toOutcomeInput, type VerifiedPayment } from "./paymentSettlement.js";
import { PaystackError } from "../utils/paystackErrors.js";
import {
    ATTEMPT_RECHECK_INTERVAL_MS,
    EXPIRED_RECHECK_WINDOW_MS,
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
    | "expired_rechecked"        // already-expired attempt checked again; still unpaid
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
    expired_rechecked: 0,
    still_pending: 0,
    needs_review: 0,
    verification_unavailable: 0,
    error: 0,
});

// Handles ONE attempt. Never closes anything it could not check first.

export const reconcileAttempt = async (
    attempt: PaymentAttemptDocument,
    now: Date = new Date()
): Promise<ReconcileAction> => {

    // Identify whether this attempt is still waiting for
    // the result of its original Paystack initialization.
    const isInitiating = attempt.status === "initiating";

    // Only investigate an initiating attempt after 10 minutes.
    // Do NOT mark it failed just because it is old.
    if (
        isInitiating &&
        !isInitiatingAttemptStale(attempt, now)
    ) {
        return "skipped";
    }

    // Ask Paystack about initiating, pending and unknown attempts.
    let verification: VerifiedPayment;

    try {
        verification = await paystackService.verifyPayment(
            attempt.reference
        );

    } catch (verifyError) {

        console.error(
            `Reconcile: could not verify ${attempt.reference}:`,
            verifyError
        );

        const referenceNotFound =
            verifyError instanceof PaystackError &&
            verifyError.kind === "not_found";

    if (isInitiating && referenceNotFound) {
        await paymentAttemptService.markInitializationFailed(
            attempt._id,
            "paystack_reference_not_found"
        );

        return "closed_failed";
    }

        // Network errors, timeouts and other unavailable responses
        // do not establish whether payment was created or completed.
        // Preserve the attempt's status and try again later.
        await paymentAttemptService.recordOutcome(
            attempt.reference,
            { providerStatus: null },
            "reconcile"
        );

        // A link was issued yet Paystack has no record of it: a person should look.
        if (referenceNotFound) return "needs_review";

        return "verification_unavailable";
    }

    // Paystack confirms payment.
    if (verification.success) {

        const booking = await Booking.findById(attempt.bookingId);

        if (!booking) {

            console.error(
                `Reconcile: attempt ${attempt.reference} was paid but booking ${attempt.bookingId} is missing`
            );

            await paymentAttemptService.recordOutcome(
                attempt.reference,
                toOutcomeInput(verification),
                "reconcile"
            );

            await paymentAttemptService.flagDuplicatePayment(
                attempt._id
            );

            return "needs_review";
        }

        await settleAttemptPayment(
            booking,
            attempt,
            verification,
            "reconcile"
        );

        return "settled";
    }

    // No checkout link was ever stored, so nobody can pay this attempt (the
    // initialize response was lost). Safe to close even if Paystack knows it.
    if (isInitiating || (attempt.status === "pending" && !attempt.authorizationUrl)) {
        await paymentAttemptService.closeUnreachable(attempt._id);
        return "closed_failed";
    }

    // Already expired and still unpaid: just note that we checked again.
    if (attempt.status === "expired") {
        await paymentAttemptService.recordOutcome(attempt.reference, toOutcomeInput(verification), "reconcile");
        return "expired_rechecked";
    }

    // Payment was not confirmed as successful.
    // Record the actual status Paystack returned.
    const outcome = await paymentAttemptService.recordOutcome(
        attempt.reference,
        toOutcomeInput(verification),
        "reconcile"
    );

    const current = outcome.attempt;

    if (!current) return "skipped";

    if (current.status === "failed") {
        return "closed_failed";
    }

    if (current.status === "unknown") {
        return "needs_review";
    }

    if (current.status === "success") {
        return "settled";
    }

    if (current.status === "expired") {
        return "expired";
    }

    // Paystack still reports an open transaction.
    // Keep it active, even if our local one-hour threshold has passed.
    // Local expiry alone does not prove that the Paystack link is unusable.
    if (current.status === "pending") {

        if (isPendingAttemptExpired(current, now)) {
            console.warn(
                `Payment attempt ${current.reference} is still pending after its local time limit. Keeping it active.`
            );
        }

        return "still_pending";
    }

    // Paystack returned an outcome we could not map to a known
    // attempt status. Do not release the attempt automatically.
    if (current.status === "initiating") {
        return "needs_review";
    }

    return "skipped";
};


export const reconcileStaleAttempts = async (now: Date = new Date()): Promise<ReconcileSummary> => {
    const attempts = await paymentAttemptService.findStaleAttempts({
        initiatingBefore: new Date(now.getTime() - INITIATING_ATTEMPT_MAX_AGE_MS),
        recheckBefore: new Date(now.getTime() - ATTEMPT_RECHECK_INTERVAL_MS),
        expiredAfter: new Date(now.getTime() - EXPIRED_RECHECK_WINDOW_MS),
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
            console.log(`Payment reconciliation schedule started (every ${RECONCILE_INTERVAL_MS / 60000} min)`);

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