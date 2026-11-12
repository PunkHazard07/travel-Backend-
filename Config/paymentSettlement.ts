import { bookingService, type ProviderOutcome } from "./bookingService.js";
import type { paystackService } from "./paystackService.js";
import { paymentAttemptService, type ProviderVerification } from "./paymentAttemptService.js";
import Booking, { type BookingDocument, type PaymentStatus } from "../Model/booking.js";
import type { PaymentAttemptDocument, ResolvedBy } from "../Model/paymentAttempt.js";

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
const confirmBookingPaid = async (booking: BookingDocument, paymentData: PaymentData, expectedAmountOverride?: number): Promise<BookingDocument> => {
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
            },
        },
        { new: true}
    );

    if (!claimed) {
        const current = await latest();
        if (OPEN_PAYMENT_STATES.includes(current.paymentStatus) && current.status === "cancelled") {
            return (await flagBooking(current._id, "paid_after_cancel", paymentData)) ?? (await latest());
        }
        return current;
    }

    // We won the claim: we're the only caller who runs the provider step.
    if (claimed.status !== "pending") {
        return claimed;
    }

    const flagProviderProblem = (reason: string, detail: string, bookingStatus: "failed" | "pending") => {
        claimed.status = bookingStatus;
        claimed.paymentStatus = "flagged";
        claimed.paymentMetadata = {
            ...(claimed.paymentMetadata ?? {}),
            flaggedReason: reason,
            providerReason: detail,
        };
    };

    // Confirm the booking with the appropriate provider:
    // LiteAPI for hotels and Duffel for flights.
    let outcome: ProviderOutcome;
    try {
        outcome = await bookingService.confirmWithProvider(claimed);
    } catch (error: any) {
        console.error(`Provider step threw after payment for booking ${claimed._id}:`, error);
        outcome = { outcome: "unknown", reason: "unexpected_error" };
    }

    if (outcome.outcome === "confirmed") {
        claimed.status = "confirmed";
        claimed.providerBookingId = outcome.providerBookingId;
        if (outcome.providerData) claimed.providerData = outcome.providerData;
    } else if (outcome.outcome === "failed") {
        // Provider said no: nothing was booked, the customer needs a refund.
        console.error(`Provider rejected booking ${claimed._id} after payment: ${outcome.reason}`);
        flagProviderProblem("provider_failed_after_payment", outcome.reason, "failed");
    } else {
        // We can't tell whether the reservation exists. Status stays
        // "pending" (NOT failed) so nobody refunds a customer who may hold a
        // real booking; re-running book with the same clientReference is
        // idempotent, so a retry/reconcile can safely settle it.
        console.error(`Provider outcome unknown for booking ${claimed._id}: ${outcome.reason}`);
        flagProviderProblem("provider_outcome_unknown", outcome.reason, "pending");
    }

    await claimed.save();
    return claimed;
};

// Settles a verified-successful payment: confirms the booking (idempotent, atomic),
// then records the outcome on the attempt. Called from verify, webhook and resume.
export const settleAttemptPayment = async (booking: BookingDocument, attempt: PaymentAttemptDocument | null, paymentData: VerifiedPayment, source: ResolvedBy): Promise<BookingDocument> => {
    const settled = await confirmBookingPaid(booking, paymentData, attempt?.amount);

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