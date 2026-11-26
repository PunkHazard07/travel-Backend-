import type { paystackService } from "./paystackService.js";
import { paymentAttemptService, type ProviderVerification } from "./paymentAttemptService.js";
import Booking, { type BookingDocument, type PaymentStatus } from "../Model/booking.js";
import type { PaymentAttemptDocument, ResolvedBy } from "../Model/paymentAttempt.js";
import { attemptQuoteStillMatches } from "../utils/supplierPrice.js";
import { fulfillBooking } from "./fulfillment.js";

export const SETTLEMENT_CURRENCY = "NGN";

export type VerifiedPayment = Awaited<ReturnType<typeof paystackService.verifyPayment>>;

//the amount paystack is asked to charge in NGN
const getExpectedChargeAmount = (booking: BookingDocument): number => booking.currencyConversion?.convertedAmount ?? booking.totalPrice;

// What a Paystack verification tells us about one attempt (see paymentAttemptService)
export const toOutcomeInput = (paymentData: VerifiedPayment): ProviderVerification => ({
    providerStatus: paymentData.status,
    gatewayResponse: paymentData.gatewayResponse,
    channel: paymentData.channel,
    amount: paymentData.amount,
    paidAt: paymentData.paidAt,
});

type PaymentData = { amount: number; paidAt: string; channel: string; reference: string };

const OPEN_PAYMENT_STATES: PaymentStatus[] = ["unpaid", "processing"];

//moves a booking to flagged to check if the money needs to be refunded or manual sent back
const flagBooking = async ( bookingId: any, reason: string, paymentData: PaymentData): Promise<BookingDocument | null> => {
    return Booking.findOneAndUpdate(
        { _id: bookingId, paymentStatus: { $in: OPEN_PAYMENT_STATES } },
        {
            $set: {
                paymentStatus: "flagged",
                paymentReference: paymentData.reference,
                paymentMetadata: {
                    paidAt: paymentData.paidAt,
                    channel: paymentData.channel,
                    amount: paymentData.amount,
                    flaggedReason: reason,
                },
            },
        },
        { new: true }
    );
};

//shared idempotent to confirm booking as a step called from both verifyPayment and paystackwebhook
// expectedAmountOverride: the amount the paying ATTEMPT was asked to charge. A late payment on
// an older attempt must be compared with that attempt's amount, not the booking's latest conversion.
const confirmBookingPaid = async (booking: BookingDocument, paymentData: PaymentData, attempt?: PaymentAttemptDocument | null): Promise<BookingDocument> => {
    const expectedAmountOverride = attempt?.amount;
    const latest = async (): Promise<BookingDocument> => (await Booking.findById(booking._id)) ?? booking;

    if (!OPEN_PAYMENT_STATES.includes(booking.paymentStatus)) {
        return booking;
    }

    //customer was charged for a booking that's been cancelled don't resurrect it and don't swallow the money either
    if (booking.status === "cancelled") {
        console.error(`Payment received for cancelled booking ${booking._id} (ref ${paymentData.reference})`);
        return (await flagBooking(booking._id, "paid_after_cancel", paymentData)) ?? (await latest());
    }

    const expectedAmount = expectedAmountOverride ?? getExpectedChargeAmount(booking);
    const expectedKobo = Math.round(expectedAmount * 100);
    const paidKobo = Math.round(paymentData.amount * 100);

    if (expectedKobo !== paidKobo) {
        console.error(
            `Payment amount mismatch for booking ${booking._id}: expected ${expectedAmount} ${SETTLEMENT_CURRENCY}, Paystack confirmed ${paymentData.amount}`
        );
        return (await flagBooking(booking._id, "amount_mismatch", paymentData)) ?? (await latest());
    }

    // The money matches what this attempt asked for, but the supplier's price has moved since
    // (the customer paid on an old link after the price changed). Booking now would mean paying
    // the supplier a different amount than the customer paid, so hold it for a refund instead.
    if (attempt && !attemptQuoteStillMatches(booking, attempt)) {
        console.error(
            `Supplier price changed since attempt ${attempt.reference} was created for booking ${booking._id}: quoted ${attempt.quotedTotal} ${attempt.quotedCurrency}, now ${booking.totalPrice}`
        );
        return (await flagBooking(booking._id, "price_changed_after_payment", paymentData)) ?? (await latest());
    }

    //Atomic claim. Only one concurrent caller gets a document back
    const claimed = await Booking.findOneAndUpdate(
        {
            _id: booking._id,
            paymentStatus: { $in: OPEN_PAYMENT_STATES },
            status: { $ne: "cancelled" },
        },
        {
            $set: {
                paymentStatus: "paid",
                paymentReference: paymentData.reference,
                paymentMetadata: {
                    paidAt: paymentData.paidAt,
                    channel: paymentData.channel,
                    amount: paymentData.amount,
                },
                fulfillmentStatus: "in_progress",
                fulfillmentStartedAt: new Date(),
                fulfillmentReason: null
            },
            $inc: { fulfillmentAttempts: 1 },
        },
        { new: true}
    );
if (!claimed) {
        const current = await latest();
        if (OPEN_PAYMENT_STATES.includes(current.paymentStatus)) {
            if (current.status === "cancelled") {
                return (await flagBooking(current._id, "paid_after_cancel", paymentData)) ?? (await latest());
            }
            if (current.status !== "pending") {
                // Money arrived for a booking that can no longer be fulfilled.
                return (await flagBooking(current._id, "paid_on_non_pending_booking", paymentData)) ?? (await latest());
            }
        }
        // Another caller won the claim. What we return may still be "in_progress"; callers must
        // read fulfillmentStatus, never assume the booking is confirmed.
        return current;
    }

    if (claimed.status !== "pending") {
        return claimed;
    }

    // We won the claim: we are the only caller who runs the supplier step. fulfillBooking never
    // throws and records the outcome atomically; anything it cannot record stays "in_progress"
    // for the recovery sweeper (see fulfillmentRecovery.ts).
    return fulfillBooking(claimed);
};

// Settles a verified-successful payment: confirms the booking (idempotent, atomic),
// then records the outcome on the attempt. Called from verify, webhook and resume.
export const settleAttemptPayment = async (booking: BookingDocument, attempt: PaymentAttemptDocument | null, paymentData: VerifiedPayment, source: ResolvedBy): Promise<BookingDocument> => {
    const settled = await confirmBookingPaid(booking, paymentData, attempt);

    if (attempt) {
        try {
            await paymentAttemptService.recordOutcome(attempt.reference, toOutcomeInput(paymentData), source);

            // The booking was already settled by a DIFFERENT attempt, so this payment
            // is a duplicate that needs a manual refund. Make it findable.
            const bookingIsSettled = settled.paymentStatus !== "unpaid" && settled.paymentStatus !== "processing";
            if (bookingIsSettled && settled.paymentReference && settled.paymentReference !== attempt.reference) {
                console.error(
                    `Duplicate payment: attempt ${attempt.reference} paid, booking ${settled._id} already settled by ${settled.paymentReference}`
                );
                await paymentAttemptService.flagDuplicatePayment(attempt._id);
            }
        } catch (recordError) {
            // The booking is already settled; a failure here must not undo or hide that.
            console.error(`Could not record outcome for attempt ${attempt.reference}:`, recordError);
        }
    }

    return settled;
};