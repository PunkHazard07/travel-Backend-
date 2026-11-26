import Booking, { type BookingDocument, type FulfillmentStatus } from "../Model/booking.js";
import { fulfillBooking, persistOutcome } from "./fulfillment.js";
import { providerLookup, type ProviderLookupResult } from "../utils/providerLookup.js";


export const IN_PROGRESS_STALE_MS = 10 * 60_000;
export const UNKNOWN_RECHECK_MS = 15 * 60_000;
export const MAX_RESEND_ATTEMPTS = 3;
export const RECOVERY_BATCH_SIZE = 25;
export const RECOVERY_INTERVAL_MS = 5 * 60_000;

const RECOVERABLE: FulfillmentStatus[] = ["in_progress", "unknown"];

export type RecoveryAction =
    | "skipped"                   // not recoverable now, or another worker got there first
    | "confirmed_from_lookup"     // supplier already had the reservation: recorded as confirmed
    | "failed_from_lookup"        // supplier had it but cancelled: recorded as failed (refund)
    | "still_pending_at_supplier" // supplier has it but not confirmed yet: check again later
    | "resent"                    // supplier definitively had nothing: one new request was made
    | "left_for_review";          // cannot be decided safely: stays "unknown" for a person

export type RecoverySummary = {
    checked: number;
    counts: Record<RecoveryAction | "error", number>;
};

const emptyCounts = (): RecoverySummary["counts"] => ({
    skipped: 0,
    confirmed_from_lookup: 0,
    failed_from_lookup: 0,
    still_pending_at_supplier: 0,
    resent: 0,
    left_for_review: 0,
    error: 0,
});

// Moves an unresolved booking to "unknown" with a reason and a check time. Never touches a booking
// that has been resolved in the meantime.
const markUnknown = async (booking: BookingDocument, reason: string, now: Date): Promise<void> => {
    await Booking.updateOne(
        { _id: booking._id, fulfillmentStatus: { $in: RECOVERABLE } },
        {
            $set: {
                status: "pending",
                fulfillmentStatus: "unknown",
                fulfillmentReason: reason,
                fulfillmentCheckedAt: now,
            },
        }
    );
};

export const recoverBooking = async (booking: BookingDocument, now: Date = new Date()): Promise<RecoveryAction> => {
    if (booking.paymentStatus !== "paid" || !RECOVERABLE.includes(booking.fulfillmentStatus)) {
        return "skipped";
    }

    let lookup: ProviderLookupResult;
    try {
        lookup = await providerLookup.find(booking);
    } catch (error: any) {
        lookup = { result: "error", reason: `lookup_threw: ${error?.message ?? error}` };
    }

    if (lookup.result === "found") {
        if (lookup.providerStatus === "confirmed") {
            const saved = await persistOutcome(
                booking._id,
                { outcome: "confirmed", providerBookingId: lookup.providerBookingId, providerData: lookup.providerData },
                RECOVERABLE
            );
            return saved ? "confirmed_from_lookup" : "skipped";
        }
        if (lookup.providerStatus === "cancelled") {
            const saved = await persistOutcome(booking._id, { outcome: "failed", reason: "supplier_cancelled" }, RECOVERABLE);
            return saved ? "failed_from_lookup" : "skipped";
        }
        await markUnknown(booking, "supplier_pending", now);
        return "still_pending_at_supplier";
    }

    if (lookup.result === "not_found") {
        if (booking.fulfillmentAttempts >= MAX_RESEND_ATTEMPTS) {
            console.error(`Booking ${booking._id} reached ${MAX_RESEND_ATTEMPTS} supplier attempts, leaving it for review`);
            await markUnknown(booking, "max_resend_attempts_reached", now);
            return "left_for_review";
        }

        // Lease: only one worker can move this exact state/attempt forward and re-send.
        const leased = await Booking.findOneAndUpdate(
            {
                _id: booking._id,
                paymentStatus: "paid",
                fulfillmentStatus: booking.fulfillmentStatus,
                fulfillmentAttempts: booking.fulfillmentAttempts,
            },
            {
                $set: { fulfillmentStatus: "in_progress", fulfillmentStartedAt: now, fulfillmentCheckedAt: now },
                $inc: { fulfillmentAttempts: 1 },
            },
            { new: true }
        );
        if (!leased) return "skipped";

        await fulfillBooking(leased);
        return "resent";
    }

    // "unsupported" or "error": we cannot prove the supplier has nothing, so we must not re-send.
    console.error(`Booking ${booking._id} needs a person: supplier lookup said ${lookup.result} (${lookup.reason})`);
    await markUnknown(booking, lookup.reason, now);
    return "left_for_review";
};

export const recoverStuckBookings = async (now: Date = new Date()): Promise<RecoverySummary> => {
    const staleBefore = new Date(now.getTime() - IN_PROGRESS_STALE_MS);
    const recheckBefore = new Date(now.getTime() - UNKNOWN_RECHECK_MS);

    const candidates: BookingDocument[] = await Booking.find({
        paymentStatus: "paid",
        $or: [
            { fulfillmentStatus: "in_progress", fulfillmentStartedAt: { $lt: staleBefore } },
            {
                fulfillmentStatus: "unknown",
                $or: [{ fulfillmentCheckedAt: null }, { fulfillmentCheckedAt: { $lt: recheckBefore } }],
            },
        ],
    })
        .sort({ updatedAt: 1 })
        .limit(RECOVERY_BATCH_SIZE);

    const counts = emptyCounts();

    for (const booking of candidates) {
        try {
            counts[await recoverBooking(booking, now)] += 1;
        } catch (error) {
            console.error(`Fulfillment recovery: unexpected error on booking ${booking._id}:`, error);
            counts.error += 1;
        }
    }

    return { checked: candidates.length, counts };
};

let recoveryTimer: NodeJS.Timeout | null = null;
let running = false;

export const startFulfillmentRecoverySchedule = (): void => {
    if (recoveryTimer) return;
    console.log(`Fulfillment recovery schedule started (every ${RECOVERY_INTERVAL_MS / 60000} min)`);

    recoveryTimer = setInterval(() => {
        if (running) return;
        running = true;

        recoverStuckBookings()
            .then((summary) => {
                if (summary.checked > 0) {
                    console.log("Fulfillment recovery:", JSON.stringify(summary));
                }
            })
            .catch((error: Error) => {
                console.error("Fulfillment recovery pass failed:", error.message);
            })
            .finally(() => {
                running = false;
            });
    }, RECOVERY_INTERVAL_MS);

    // Never keep the process alive just for this timer.
    recoveryTimer.unref();
};

export const stopFulfillmentRecoverySchedule = (): void => {
    if (recoveryTimer) {
        clearInterval(recoveryTimer);
        recoveryTimer = null;
    }
};