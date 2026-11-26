import type { BookingDocument } from "../Model/booking.js";

export type SettlementCode =
    | "BOOKING_CONFIRMED"
    | "BOOKING_PROCESSING"
    | "BOOKING_UNDER_CONFIRMATION"
    | "BOOKING_FAILED"
    | "PAYMENT_UNDER_REVIEW"
    | "DUPLICATE_PAYMENT"
    | "PAYMENT_REFUNDED"
    | "PAYMENT_NOT_APPLIED";

    export interface SettlementResponse {
    httpStatus: 200 | 202 | 409;
    // True when the payment was accepted (200 and 202). It says nothing about the booking.
    success: boolean;
    // True ONLY when the supplier confirmed. Frontends should key off this, not off `success`.
    bookingConfirmed: boolean;
    code: SettlementCode;
    message: string;
}

const MANUAL_REVIEW = "Your payment was received but the booking needs manual review. Please contact support and quote your booking reference.";

// Pure function of what is stored: payment status and supplier status are checked independently,
// and "confirmed" needs BOTH to agree plus the supplier's own booking id.
// `paidReference` is the Paystack reference being verified, used to spot a duplicate payment.
export const describeSettlement = (
    booking: Pick<BookingDocument, "status" | "paymentStatus" | "fulfillmentStatus" | "providerBookingId" | "paymentReference">,
    paidReference: string
): SettlementResponse => {
    const { paymentStatus, fulfillmentStatus } = booking;

    // 1. The money. Anything other than "paid" is decided before the supplier is even considered.
    if (paymentStatus === "flagged") {
        return { httpStatus: 409, success: false, bookingConfirmed: false, code: "PAYMENT_UNDER_REVIEW", message: MANUAL_REVIEW };
    }
    if (paymentStatus === "refunded") {
        return {
            httpStatus: 409,
            success: false,
            bookingConfirmed: false,
            code: "PAYMENT_REFUNDED",
            message: "This payment has been refunded, so there is no active booking for it.",
        };
    }
    if (paymentStatus !== "paid") {
        // "unpaid" / "processing": Paystack says paid, but our booking has not recorded it yet.
        return {
            httpStatus: 202,
            success: true,
            bookingConfirmed: false,
            code: "PAYMENT_NOT_APPLIED",
            message: "Your payment was received and is being applied to your booking. Please check again shortly.",
        };
    }

    // 2. Paid, but by a different reference: this payment is a duplicate that needs a refund,
    //    whatever state the booking itself is in.
    if (booking.paymentReference && booking.paymentReference !== paidReference) {
        return {
            httpStatus: 409,
            success: false,
            bookingConfirmed: false,
            code: "DUPLICATE_PAYMENT",
            message:
                "This booking was already paid with another payment, so this payment is a duplicate and will be refunded. Please contact support and quote your booking reference.",
        };
    }

    // 3. Paid, so now (and only now) what the supplier did.
    if (fulfillmentStatus === "confirmed" && booking.status === "confirmed" && booking.providerBookingId) {
        return {
            httpStatus: 200,
            success: true,
            bookingConfirmed: true,
            code: "BOOKING_CONFIRMED",
            message: "Payment verified and booking confirmed",
        };
    }

    if (fulfillmentStatus === "failed") {
        return {
            httpStatus: 409,
            success: false,
            bookingConfirmed: false,
            code: "BOOKING_FAILED",
            message:
                "Your payment was received but the provider could not complete your booking. You will be refunded. Please contact support and quote your booking reference.",
        };
    }

    if (fulfillmentStatus === "unknown") {
        return {
            httpStatus: 202,
            success: true,
            bookingConfirmed: false,
            code: "BOOKING_UNDER_CONFIRMATION",
            message:
                "Your payment was received. We are still confirming your booking with the provider. Please do not pay again; we will update your booking shortly.",
        };
    }

    // "in_progress", "not_started", or a state that claims to be confirmed without the supplier's id.
    return {
        httpStatus: 202,
        success: true,
        bookingConfirmed: false,
        code: "BOOKING_PROCESSING",
        message: "Your payment was received and your booking is being confirmed. Please check again shortly.",
    };
};
