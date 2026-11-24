import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const bookingFindOne = jest.fn<(...args: any[]) => Promise<any>>();
const bookingFindById = jest.fn<(...args: any[]) => Promise<any>>();
const bookingFindOneAndUpdate = jest.fn<(...args: any[]) => Promise<any>>();
const bookingUpdateOne = jest.fn<(...args: any[]) => Promise<any>>();

const paystackInitialize = jest.fn<(...args: any[]) => Promise<any>>();
const paystackVerify = jest.fn<(...args: any[]) => Promise<any>>();

const revalidateForPayment = jest.fn<(...args: any[]) => Promise<any>>();
const confirmWithProvider = jest.fn<(...args: any[]) => Promise<any>>();
const convertForCheckout = jest.fn<(...args: any[]) => Promise<number>>();

const getBlockingAttempts = jest.fn<(...args: any[]) => Promise<any[]>>();
const reserve = jest.fn<(...args: any[]) => Promise<any>>();
const markPending = jest.fn<(...args: any[]) => Promise<any>>();
const markInitializationFailed = jest.fn<(...args: any[]) => Promise<any>>();
const recordOutcome = jest.fn<(...args: any[]) => Promise<any>>();
const expire = jest.fn<(...args: any[]) => Promise<any>>();
const closeUnreachable = jest.fn<(...args: any[]) => Promise<any>>();
const findByReference = jest.fn<(...args: any[]) => Promise<any>>();
const flagDuplicatePayment = jest.fn<(...args: any[]) => Promise<any>>();

class MockBookingError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

jest.unstable_mockModule("../Model/booking.js", () => ({
    __esModule: true,
    default: {
        findOne: bookingFindOne,
        findById: bookingFindById,
        findOneAndUpdate: bookingFindOneAndUpdate,
        updateOne: bookingUpdateOne,
    },
}));
jest.unstable_mockModule("../Config/paystackService.js", () => ({
    paystackService: {
        initializePayment: paystackInitialize,
        verifyPayment: paystackVerify,
        verifyWebhookSignature: jest.fn(),
    },
}));
jest.unstable_mockModule("../Config/bookingService.js", () => ({
    bookingService: { revalidateForPayment, confirmWithProvider },
    BookingError: MockBookingError,
}));
jest.unstable_mockModule("../utils/currencyConverter.js", () => ({ convertForCheckout }));
jest.unstable_mockModule("../Config/paymentAttemptService.js", () => ({
    paymentAttemptService: {
        getBlockingAttempts,
        reserve,
        markPending,
        markInitializationFailed,
        recordOutcome,
        expire,
        closeUnreachable,
        findByReference,
        flagDuplicatePayment,
    },
}));

const { initializePayment } = await import("../Controller/paymentController.js");

const OLD_REF = "BK-TEST123456-AAAA1111";
const NEW_REF = "BK-TEST123456-BBBB2222";

const makeBooking = (overrides: Record<string, any> = {}) => ({
    _id: { toString: () => "booking-1" },
    bookingType: "flight",
    bookingReference: "BK-TEST123456",
    totalPrice: 500,
    flightData: { price: { currency: "GBP" } },
    status: "pending",
    paymentStatus: "unpaid",
    paymentReference: null,
    ...overrides,
});

const makePendingAttempt = (overrides: Record<string, any> = {}) => ({
    _id: { toString: () => "attempt-old" },
    bookingId: "booking-1",
    reference: OLD_REF,
    amount: 100,
    status: "pending",
    authorizationUrl: "https://paystack.test/old-link",
    accessCode: "old-access",
    ...overrides,
});

const abandonedVerification = {
    success: false,
    status: "abandoned",
    gatewayResponse: "gateway",
    amount: 0,
    reference: OLD_REF,
    paidAt: null,
    channel: null,
    metadata: {},
};

const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const initReq = (extra: Record<string, any> = {}) =>
    ({ body: { bookingId: "booking-1", ...extra }, user: { id: "user-1", email: "ada@example.com" } }) as any;

const body = (res: any) => res.json.mock.calls[0][0];

const unchanged = (overrides: Record<string, any> = {}) => ({
    revalidated: true,
    priceChanged: false,
    previousTotal: 500,
    newTotal: 500,
    currency: "GBP",
    ...overrides,
});

const resumePending = () => {
    const pending = makePendingAttempt();
    getBlockingAttempts.mockResolvedValue([pending]);
    paystackVerify.mockResolvedValue(abandonedVerification);
    recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: pending });
    return pending;
};

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    bookingFindOne.mockResolvedValue(makeBooking());
    bookingUpdateOne.mockResolvedValue({});
    revalidateForPayment.mockResolvedValue(unchanged());
    convertForCheckout.mockResolvedValue(900000);
    getBlockingAttempts.mockResolvedValue([]);
    reserve.mockResolvedValue({
        conflict: false,
        attempt: { _id: { toString: () => "attempt-new" }, reference: NEW_REF },
    });
    markPending.mockResolvedValue({});
    recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: null });
    expire.mockResolvedValue({ status: "expired" });
    paystackInitialize.mockResolvedValue({
        reference: NEW_REF,
        authorizationUrl: "https://paystack.test/new-link",
        accessCode: "new-access",
    });
});

describe("new payment: price check comes first", () => {
    it("unchanged price: charges and records the supplier total on the attempt", async () => {
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(revalidateForPayment).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(reserve).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 900000, currency: "NGN", quotedTotal: 500, quotedCurrency: "GBP" })
        );
    });

    it("price increase: 409 PRICE_CHANGED, nothing charged or reserved", async () => {
        revalidateForPayment.mockResolvedValue(unchanged({ priceChanged: true, newTotal: 550 }));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res)).toEqual(
            expect.objectContaining({
                success: false,
                code: "PRICE_CHANGED",
                details: { previousTotal: 500, newTotal: 550, currency: "GBP" },
            })
        );
        expect(convertForCheckout).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("price decrease: also stops for confirmation", async () => {
        revalidateForPayment.mockResolvedValue(unchanged({ priceChanged: true, newTotal: 450 }));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("PRICE_CHANGED");
        expect(body(res).details).toEqual(expect.objectContaining({ previousTotal: 500, newTotal: 450 }));
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("currency change is reported with the previous currency", async () => {
        revalidateForPayment.mockResolvedValue(unchanged({ priceChanged: true, currency: "USD", previousCurrency: "GBP" }));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(body(res).details).toEqual(expect.objectContaining({ currency: "USD", previousCurrency: "GBP" }));
    });

    it("the charge uses the total from the check, not the one the booking had before it", async () => {
        revalidateForPayment.mockImplementation(async (booking: any) => {
            booking.totalPrice = 520;
            return unchanged({ newTotal: 520 });
        });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(convertForCheckout).toHaveBeenCalledWith(520, "GBP", "NGN");
        expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ quotedTotal: 520 }));
    });

    it("hotel: the amount charged is the refreshed total", async () => {
        bookingFindOne.mockResolvedValue(
            makeBooking({ bookingType: "hotel", flightData: undefined, totalPrice: 100000 })
        );
        revalidateForPayment.mockImplementation(async (booking: any) => {
            booking.totalPrice = 100200;
            return unchanged({ previousTotal: 100000, newTotal: 100200, currency: "NGN" });
        });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(convertForCheckout).not.toHaveBeenCalled();
        expect(reserve).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 100200, quotedTotal: 100200, quotedCurrency: "NGN" })
        );
        expect(paystackInitialize.mock.calls[0][1]).toBe(100200);
    });

    it.each([
        [409, "OFFER_EXPIRED"],
        [409, "OFFER_UNAVAILABLE"],
        [502, "PROVIDER_UNAVAILABLE"],
        [503, "PROVIDER_UNAVAILABLE"],
    ])("supplier says %i %s: payment is blocked", async (status, code) => {
        revalidateForPayment.mockRejectedValue(new MockBookingError(status, code, "supplier problem"));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(status);
        expect(body(res)).toEqual(expect.objectContaining({ success: false, code }));
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("an unexpected error while checking the price is a 500, not a payment", async () => {
        revalidateForPayment.mockRejectedValue(new Error("database down"));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });
});

describe("expectedTotal (the customer's confirmation)", () => {
    it("matching the current total: payment starts", async () => {
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: 500 }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(reserve).toHaveBeenCalledTimes(1);
    });

    it("accepts the total as a numeric string", async () => {
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: "500.00" }), res);

        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("not matching the current total: asked to confirm again, nothing reserved", async () => {
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: 450 }), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res)).toEqual(
            expect.objectContaining({
                code: "PRICE_CHANGED",
                details: { previousTotal: 450, newTotal: 500, currency: "GBP" },
            })
        );
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("the price moved again after the customer confirmed: stops and asks again", async () => {
        revalidateForPayment.mockResolvedValue(unchanged({ priceChanged: true, previousTotal: 550, newTotal: 560 }));
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: 550 }), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).details).toEqual(expect.objectContaining({ previousTotal: 550, newTotal: 560 }));
        expect(reserve).not.toHaveBeenCalled();
    });

    it("a one-cent difference on a flight is not accepted", async () => {
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: 500.01 }), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("PRICE_CHANGED");
    });

    it.each([["abc"], [0], [-5], [{}]])("rejects an invalid expectedTotal (%p) before any external call", async (value) => {
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: value }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(revalidateForPayment).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
    });
});

describe("existing payment attempt", () => {
    it("price unchanged: resumes the same link and leaves the attempt open", async () => {
        resumePending();
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(revalidateForPayment).toHaveBeenCalledTimes(1);
        expect(expire).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(body(res).data).toEqual(expect.objectContaining({ authorizationUrl: "https://paystack.test/old-link", resumed: true }));
        expect(reserve).not.toHaveBeenCalled();
    });

    it("price changed: the old attempt is closed, the old link is not handed back", async () => {
        const pending = resumePending();
        revalidateForPayment.mockResolvedValue(unchanged({ priceChanged: true, newTotal: 550 }));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(expire).toHaveBeenCalledWith(pending._id, "superseded_price_changed");
        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("PRICE_CHANGED");
        expect(JSON.stringify(body(res))).not.toContain("old-link");
        expect(reserve).not.toHaveBeenCalled();
    });

    it("price decreased: the old attempt is closed as well", async () => {
        const pending = resumePending();
        revalidateForPayment.mockResolvedValue(unchanged({ priceChanged: true, newTotal: 450 }));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(expire).toHaveBeenCalledWith(pending._id, "superseded_price_changed");
        expect(res.status).toHaveBeenCalledWith(409);
    });

    it("offer expired: the old attempt is closed and payment is blocked", async () => {
        const pending = resumePending();
        revalidateForPayment.mockRejectedValue(new MockBookingError(409, "OFFER_EXPIRED", "expired"));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(expire).toHaveBeenCalledWith(pending._id, "superseded_offer_expired");
        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("OFFER_EXPIRED");
    });

    it("offer unavailable: the old attempt is closed and payment is blocked", async () => {
        const pending = resumePending();
        revalidateForPayment.mockRejectedValue(new MockBookingError(409, "OFFER_UNAVAILABLE", "gone"));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(expire).toHaveBeenCalledWith(pending._id, "superseded_offer_unavailable");
        expect(body(res).code).toBe("OFFER_UNAVAILABLE");
    });

    it("supplier temporarily down: payment is blocked but the attempt is left alone", async () => {
        resumePending();
        revalidateForPayment.mockRejectedValue(new MockBookingError(502, "PROVIDER_UNAVAILABLE", "down"));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(expire).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(502);
        expect(body(res).code).toBe("PROVIDER_UNAVAILABLE");
    });

    it("customer confirmed a different total: asked again, the attempt stays open for the current total", async () => {
        resumePending();
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: 450 }), res);

        expect(expire).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("PRICE_CHANGED");
    });

    it("after the old attempt was closed, the customer's confirmation starts a fresh attempt at the new total", async () => {
        getBlockingAttempts.mockResolvedValue([]);
        bookingFindOne.mockResolvedValue(makeBooking({ totalPrice: 550 }));
        revalidateForPayment.mockResolvedValue(unchanged({ previousTotal: 550, newTotal: 550 }));
        convertForCheckout.mockResolvedValue(990000);
        const res = makeRes();

        await initializePayment(initReq({ expectedTotal: 550 }), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(reserve).toHaveBeenCalledWith(
            expect.objectContaining({ amount: 990000, quotedTotal: 550, quotedCurrency: "GBP" })
        );
        expect(body(res).data.resumed).toBe(false);
    });
});