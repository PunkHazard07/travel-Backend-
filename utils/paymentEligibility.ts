import type { BookingStatus, PaymentStatus } from "../Model/booking.js";

export type PaymentIneligibleCode =
    | "ALREADY_PAID"
    | "PAYMENT_IN_PROGRESS"
    | "PAYMENT_FLAGGED"
    | "PAYMENT_REFUNDED"
    | "BOOKING_NOT_PAYABLE";

    export type PaymentEligibility = {
    eligible: boolean;
    code?: PaymentIneligibleCode;
    message?: string;
};

// Allowlist: the ONLY combination that may start a payment.
// Anything not listed here is rejected, including states added in the future.
const PAYABLE_BOOKING_STATUS: BookingStatus = "pending";
const PAYABLE_PAYMENT_STATUS: PaymentStatus = "unpaid";

const PAYMENT_STATUS_REJECTIONS: Partial<
    Record<PaymentStatus, { code: PaymentIneligibleCode; message: string }>
> = {
    paid: { code: "ALREADY_PAID", message: "Booking has already been paid for" },
    processing: {
        code: "PAYMENT_IN_PROGRESS",
        message: "A payment for this booking is already in progress",
    },
    flagged: {
        code: "PAYMENT_FLAGGED",
        message: "This booking is under review. Please contact support",
    },
    refunded: { code: "PAYMENT_REFUNDED", message: "This booking has been refunded" },
};

export const checkPaymentEligibility = (booking: {
    status: BookingStatus;
    paymentStatus: PaymentStatus;
}): PaymentEligibility => {
    if (
        booking.status === PAYABLE_BOOKING_STATUS &&
        booking.paymentStatus === PAYABLE_PAYMENT_STATUS
    ) {
        return { eligible: true };
    }

    const paymentRejection = PAYMENT_STATUS_REJECTIONS[booking.paymentStatus];
    if (paymentRejection) {
        return { eligible: false, ...paymentRejection };
    }

    return {
        eligible: false,
        code: "BOOKING_NOT_PAYABLE",
        message: `A ${booking.status} booking cannot be paid for`,
    };
};