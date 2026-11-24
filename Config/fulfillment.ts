import Booking, { type BookingDocument, type FulfillmentStatus } from "../Model/booking.js";
import { bookingService, type ProviderOutcome } from "./bookingService.js";

const PERSIST_ATTEMPTS =3;
const PERSIST_BACKOFF_MS = 150;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One supplier outcome -> one atomic update of every field that describes it.
// booking.status mirrors fulfillment: "confirmed" only ever comes from a supplier confirmation.
export const outcomeToSet = (outcome: ProviderOutcome, now: Date = new Date()): Record<string, any> => {
    switch (outcome.outcome) {
        case "confirmed":
            return {
                status: "confirmed",
                fulfillmentStatus: "confirmed",
                fulfillmentReason: null,
                fulfillmentCheckedAt: now,
                providerBookingId: outcome.providerBookingId,
                ...(outcome.providerData ? { providerData: outcome.providerData } : {}),
            };
        case "failed":
            // The supplier clearly refused: nothing exists there. Money was taken, so this
            // is a refund case (paymentStatus "paid" + fulfillmentStatus "failed").
            return {
                status: "failed",
                fulfillmentStatus: "failed",
                fulfillmentReason: outcome.reason,
                fulfillmentCheckedAt: now,
            };
        default:
             // We cannot tell whether a reservation exists. Stays "pending", NOT "failed",
            // so nobody refunds a customer who may hold a real booking.
            return {
                status: "pending",
                fulfillmentStatus: "unknown",
                fulfillmentReason: outcome.reason,
                fulfillmentCheckedAt: now,
            };
    }
};

// Writes the supplier outcome, only if the booking is still in one of the `from` states
// (so two writers can never overwrite each other's result). Retries transient DB errors.
// Returns null when the write could not be made or the booking was already resolved.
export const persistOutcome = async (bookingId: unknown, outcome: ProviderOutcome, from: FulfillmentStatus[] = ["in_progress"]): Promise<BookingDocument | null> => {
    const set = outcomeToSet(outcome);

    for (let attempt = 1; attempt <= PERSIST_ATTEMPTS; attempt++ ) {
        try {
            return await Booking.findOneAndUpdate(
                { _id: bookingId, fulfillmentStatus: { $in: from } },
                { $set: set },
                { new: true }
            );
        } catch (error) {
            console.error(`Could not record supplier outcome for booking ${bookingId} (try ${attempt}/${PERSIST_ATTEMPTS}):`, error);
            if (attempt < PERSIST_ATTEMPTS) await sleep(PERSIST_BACKOFF_MS * attempt);
        }
    }

    console.error(
        `UNRECORDED SUPPLIER OUTCOME for booking ${bookingId}: ${JSON.stringify(outcome)}. ` +
            `The booking stays in_progress until the recovery sweeper resolves it.`
    );
    return null;
};

// Calls the supplier once and records the answer. Never throws: the customer has paid,
// so a failure here must end up as a recoverable state, not a 500.
export const fulfillBooking = async (booking: BookingDocument): Promise<BookingDocument> => {
    let outcome: ProviderOutcome;
    try {
        outcome = await bookingService.confirmWithProvider(booking);
    } catch (error: any) {
        console.error(`Provider step threw after payment for booking ${booking._id}:`, error);
        outcome = { outcome: "unknown", reason: "unexpected_error" };
    }

    if (outcome.outcome === "failed") {
        console.error(`Provider rejected booking ${booking._id} after payment: ${outcome.reason}`);
    } else if (outcome.outcome === "unknown") {
        console.error(`Provider outcome unknown for booking ${booking._id}: ${outcome.reason}`);
    }

    const saved = await persistOutcome(booking._id, outcome);
    if (saved) return saved;

    // Either the write failed (still in_progress) or something else already resolved it.
    // Show the latest stored state when we can; otherwise the claimed document, which
    // still says in_progress, and never "confirmed".
    try {
        return (await Booking.findById(booking._id)) ?? booking;
    } catch {
        return booking;
    }
};
