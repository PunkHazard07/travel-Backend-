import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const bookingFindOneAndUpdate = jest.fn<(...args: any[]) => Promise<any>>();
const bookingFindById = jest.fn<(...args: any[]) => Promise<any>>();
const confirmWithProvider = jest.fn<(...args: any[]) => Promise<any>>();
const recordOutcome = jest.fn<(...args: any[]) => Promise<any>>();
const flagDuplicatePayment = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../Model/booking.js", () => ({
    __esModule: true,
    default: { findOneAndUpdate: bookingFindOneAndUpdate, findById: bookingFindById },
}));
jest.unstable_mockModule("../Config/bookingService.js", () => ({
    bookingService: { confirmWithProvider },
}));
jest.unstable_mockModule("../Config/paymentAttemptService.js", () => ({
    paymentAttemptService: { recordOutcome, flagDuplicatePayment },
}));

const { settleAttemptPayment } = await import("../Config/paymentSettlement.js");
const { attemptQuoteStillMatches, supplierCurrency, totalsMatch } = await import("../utils/supplierPrice.js");

const REF = "BK-TEST123456-AAAA1111";

const makeBooking = (overrides: Record<string, any> = {}) => ({
    _id: "booking-1",
    bookingType: "flight",
    bookingReference: "BK-TEST123456",
    totalPrice: 550,
    flightData: { price: { currency: "GBP" } },
    status: "pending",
    paymentStatus: "unpaid",
    paymentReference: null,
    save: jest.fn(async () => undefined),
    ...overrides,
}) as any;

const makeAttempt = (overrides: Record<string, any> = {}) => ({
    _id: "attempt-1",
    reference: REF,
    amount: 900000,
    quotedTotal: 500,
    quotedCurrency: "GBP",
    ...overrides,
}) as any;

const payment = (overrides: Record<string, any> = {}) => ({
    success: true,
    status: "success",
    gatewayResponse: "ok",
    amount: 900000,
    reference: REF,
    paidAt: "2026-11-20T10:00:00.000Z",
    channel: "card",
    metadata: {},
    ...overrides,
}) as any;

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: null });
    bookingFindById.mockResolvedValue(null);
    // Stateful: each update is applied on top of the previous stored document, like the real DB,
    // so the claim (paid) followed by the supplier outcome (confirmed) ends up as one document.
    let stored: any = null;
    bookingFindOneAndUpdate.mockImplementation(async (_filter: any, update: any) => {
        stored = { ...(stored ?? makeBooking()), ...update.$set };
        return stored;
    });
    confirmWithProvider.mockResolvedValue({ outcome: "confirmed", providerBookingId: "ord_1" });
});

describe("late payment on an attempt created for an older price", () => {
    it("is flagged for refund and never sent to the supplier", async () => {
        const result = await settleAttemptPayment(makeBooking({ totalPrice: 550 }), makeAttempt({ quotedTotal: 500 }), payment(), "verify");

        expect(result.paymentStatus).toBe("flagged");
        const [, update] = bookingFindOneAndUpdate.mock.calls[0];
        expect(update.$set.paymentStatus).toBe("flagged");
        expect(update.$set.paymentMetadata.flaggedReason).toBe("price_changed_after_payment");
        expect(confirmWithProvider).not.toHaveBeenCalled();
    });

    it("also when the price went down", async () => {
        const result = await settleAttemptPayment(makeBooking({ totalPrice: 450 }), makeAttempt({ quotedTotal: 500 }), payment(), "webhook");

        expect(result.paymentStatus).toBe("flagged");
        expect(confirmWithProvider).not.toHaveBeenCalled();
    });

    it("also when the supplier currency changed", async () => {
        const booking = makeBooking({ totalPrice: 500, flightData: { price: { currency: "USD" } } });

        const result = await settleAttemptPayment(booking, makeAttempt({ quotedTotal: 500, quotedCurrency: "GBP" }), payment(), "verify");

        expect(result.paymentStatus).toBe("flagged");
        expect(confirmWithProvider).not.toHaveBeenCalled();
    });
});

describe("payment on an attempt whose price still holds", () => {
    it("confirms the booking with the supplier as before", async () => {
        const result = await settleAttemptPayment(makeBooking({ totalPrice: 500 }), makeAttempt({ quotedTotal: 500 }), payment(), "verify");

        expect(confirmWithProvider).toHaveBeenCalledTimes(1);
        expect(result.status).toBe("confirmed");
        expect(result.paymentStatus).toBe("paid");
    });

    it("attempts created before quotes existed are not flagged", async () => {
        const attempt = makeAttempt({ quotedTotal: undefined, quotedCurrency: undefined });

        const result = await settleAttemptPayment(makeBooking({ totalPrice: 550 }), attempt, payment(), "verify");

        expect(confirmWithProvider).toHaveBeenCalledTimes(1);
        expect(result.paymentStatus).toBe("paid");
    });

    it("a payment with no attempt at all is settled as before", async () => {
        const result = await settleAttemptPayment(makeBooking({ totalPrice: 900000, flightData: { price: { currency: "NGN" } } }), null, payment(), "webhook");

        expect(confirmWithProvider).toHaveBeenCalledTimes(1);
        expect(result.paymentStatus).toBe("paid");
    });
});

describe("supplier price helpers", () => {
    it("flights compare to the cent", () => {
        const flight = { bookingType: "flight", totalPrice: 500 };
        expect(totalsMatch(flight, 500, 500)).toBe(true);
        expect(totalsMatch(flight, 500, 500.004)).toBe(true);
        expect(totalsMatch(flight, 500, 500.01)).toBe(false);
    });

    it("hotels keep their rounding tolerance", () => {
        const hotel = { bookingType: "hotel", totalPrice: 100000 };
        expect(totalsMatch(hotel, 100000, 100200)).toBe(true);
        expect(totalsMatch(hotel, 100000, 101000)).toBe(false);
    });

    it("works out the currency a booking's total is stored in", () => {
        expect(supplierCurrency({ bookingType: "flight", totalPrice: 1, flightData: { price: { currency: "gbp" } } })).toBe("GBP");
        expect(supplierCurrency({ bookingType: "hotel", totalPrice: 1 })).toBe("NGN");
    });

    it("an attempt with no quote matches anything", () => {
        expect(attemptQuoteStillMatches({ bookingType: "flight", totalPrice: 999 }, {})).toBe(true);
        expect(attemptQuoteStillMatches({ bookingType: "flight", totalPrice: 999 }, { quotedTotal: null })).toBe(true);
    });
});