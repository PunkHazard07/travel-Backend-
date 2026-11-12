import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const bookingFindOne = jest.fn<(...args: any[]) => Promise<any>>();
const bookingFindById = jest.fn<(...args: any[]) => Promise<any>>();
const bookingFindOneAndUpdate = jest.fn<(...args: any[]) => Promise<any>>();
const bookingUpdateOne = jest.fn<(...args: any[]) => Promise<any>>();

const paystackInitialize = jest.fn<(...args: any[]) => Promise<any>>();
const paystackVerify = jest.fn<(...args: any[]) => Promise<any>>();
const verifyWebhookSignature = jest.fn<(...args: any[]) => boolean>();

const refreshPrebookIfStale = jest.fn<(...args: any[]) => Promise<any>>();
const confirmWithProvider = jest.fn<(...args: any[]) => Promise<any>>();
const convertForCheckout = jest.fn<(...args: any[]) => Promise<number>>();

const getBlockingAttempts = jest.fn<(...args: any[]) => Promise<any[]>>();
const reserve = jest.fn<(...args: any[]) => Promise<any>>();
const markPending = jest.fn<(...args: any[]) => Promise<any>>();
const markInitializationFailed = jest.fn<(...args: any[]) => Promise<any>>();
const recordOutcome = jest.fn<(...args: any[]) => Promise<any>>();
const expire = jest.fn<(...args: any[]) => Promise<any>>();
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
        verifyWebhookSignature,
    },
}));
jest.unstable_mockModule("../Config/bookingService.js", () => ({
    bookingService: { refreshPrebookIfStale, confirmWithProvider },
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
        findByReference,
        flagDuplicatePayment,
    },
}));

const { initializePayment, verifyPayment, paystackWebhook } = await import("../Controller/paymentController.js");
const { decideAttemptRetry } = await import("../utils/paymentAttemptEligibility.js");

const OLD_REF = "BK-TEST123456-AAAA1111";
const NEW_REF = "BK-TEST123456-BBBB2222";

const makeBooking = (overrides: Record<string, any> = {}) => ({
    _id: { toString: () => "booking-1" },
    bookingType: "flight",
    bookingReference: "BK-TEST123456",
    totalPrice: 100,
    flightData: { price: { currency: "NGN" } },
    status: "pending",
    paymentStatus: "unpaid",
    paymentReference: null,
    ...overrides,
});

const makeAttempt = (status: string, overrides: Record<string, any> = {}) => ({
    _id: { toString: () => `attempt-${status}` },
    bookingId: "booking-1",
    reference: OLD_REF,
    amount: 100,
    status,
    authorizationUrl: "https://paystack.test/old-link",
    accessCode: "old-access",
    ...overrides,
});

const makeVerification = (status: string, overrides: Record<string, any> = {}) => ({
    success: status === "success",
    status,
    gatewayResponse: "gateway",
    amount: 100,
    reference: OLD_REF,
    paidAt: "2026-11-09T10:00:00.000Z",
    channel: "card",
    metadata: {},
    ...overrides,
});

const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const initReq = () =>
    ({ body: { bookingId: "booking-1" }, user: { id: "user-1", email: "ada@example.com" } }) as any;

const verifyReq = (reference: string) =>
    ({ query: { reference }, user: { id: "user-1" } }) as any;

const webhookReq = (reference: string) =>
    ({
        headers: { "x-paystack-signature": "sig" },
        rawBody: Buffer.from("{}"),
        body: { event: "charge.success", data: { reference } },
    }) as any;

const body = (res: any) => res.json.mock.calls[0][0];

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    bookingFindOne.mockResolvedValue(makeBooking());
    bookingUpdateOne.mockResolvedValue({});
    refreshPrebookIfStale.mockResolvedValue({ priceChanged: false });
    convertForCheckout.mockResolvedValue(100);
    getBlockingAttempts.mockResolvedValue([]);
    reserve.mockResolvedValue({
        conflict: false,
        attempt: { _id: { toString: () => "attempt-new" }, reference: NEW_REF },
    });
    markPending.mockResolvedValue({});
    markInitializationFailed.mockResolvedValue(undefined);
    recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: null });
    expire.mockResolvedValue({ status: "expired" });
    flagDuplicatePayment.mockResolvedValue(undefined);
    paystackInitialize.mockResolvedValue({
        reference: NEW_REF,
        authorizationUrl: "https://paystack.test/new-link",
        accessCode: "new-access",
    });
});

describe("decideAttemptRetry", () => {
    it("no attempts -> create", () => {
        expect(decideAttemptRetry([]).action).toBe("create");
    });

    it("pending -> resume that attempt", () => {
        const pending = makeAttempt("pending") as any;
        const decision = decideAttemptRetry([pending]);
        expect(decision.action).toBe("resume");
        expect(decision.attempt).toBe(pending);
    });

    it("success -> reject ALREADY_PAID", () => {
        const decision = decideAttemptRetry([makeAttempt("success") as any]);
        expect(decision).toEqual(expect.objectContaining({ action: "reject", code: "ALREADY_PAID" }));
    });

    it("initiating -> reject PAYMENT_IN_PROGRESS", () => {
        const decision = decideAttemptRetry([makeAttempt("initiating") as any]);
        expect(decision).toEqual(expect.objectContaining({ action: "reject", code: "PAYMENT_IN_PROGRESS" }));
    });

    it("unknown -> reject PAYMENT_UNDER_REVIEW", () => {
        const decision = decideAttemptRetry([makeAttempt("unknown") as any]);
        expect(decision).toEqual(expect.objectContaining({ action: "reject", code: "PAYMENT_UNDER_REVIEW" }));
    });

    it("failed and expired never block", () => {
        expect(decideAttemptRetry([makeAttempt("failed") as any]).action).toBe("create");
        expect(decideAttemptRetry([makeAttempt("expired") as any]).action).toBe("create");
    });

    it("success wins over any other attempt", () => {
        const decision = decideAttemptRetry([makeAttempt("pending") as any, makeAttempt("success") as any]);
        expect(decision.code).toBe("ALREADY_PAID");
    });
});

describe("initializePayment attempts", () => {
    it("first payment attempt: reserves, charges under the attempt reference, keeps booking unpaid", async () => {
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(paystackVerify).not.toHaveBeenCalled();
        expect(reserve).toHaveBeenCalledWith(
            expect.objectContaining({ bookingReference: "BK-TEST123456", amount: 100, currency: "NGN" })
        );
        expect(paystackInitialize.mock.calls[0][2]).toBe(NEW_REF);
        expect(paystackInitialize.mock.calls[0][3]).toEqual(
            expect.objectContaining({ bookingReference: "BK-TEST123456", attemptId: "attempt-new" })
        );
        expect(markPending).toHaveBeenCalledWith(expect.anything(), {
            authorizationUrl: "https://paystack.test/new-link",
            accessCode: "new-access",
        });

        const [filter, update] = bookingUpdateOne.mock.calls[0];
        expect(filter.paymentStatus).toBe("unpaid");
        expect(update.$set.paymentReference).toBe(NEW_REF);
        expect(update.$set.paymentStatus).toBeUndefined();

        expect(res.status).toHaveBeenCalledWith(200);
        expect(body(res).data).toEqual({
            authorizationUrl: "https://paystack.test/new-link",
            reference: NEW_REF,
            accessCode: "new-access",
            resumed: false,
        });
    });

    it("retry after confirmed failure: records the failure and starts a new attempt", async () => {
        getBlockingAttempts.mockResolvedValue([makeAttempt("pending")]);
        paystackVerify.mockResolvedValue(makeVerification("failed"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: makeAttempt("failed") });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(paystackVerify).toHaveBeenCalledWith(OLD_REF);
        expect(recordOutcome).toHaveBeenCalledWith(OLD_REF, expect.objectContaining({ providerStatus: "failed" }), "verify");
        expect(reserve).toHaveBeenCalledTimes(1);
        expect(paystackInitialize).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(body(res).data.resumed).toBe(false);
        expect(body(res).data.reference).toBe(NEW_REF);
    });

    it("retry while payment is pending (abandoned at Paystack): resumes the same link", async () => {
        const pending = makeAttempt("pending");
        getBlockingAttempts.mockResolvedValue([pending]);
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: pending });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(body(res).data).toEqual({
            authorizationUrl: "https://paystack.test/old-link",
            reference: OLD_REF,
            accessCode: "old-access",
            resumed: true,
        });
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
        expect(convertForCheckout).not.toHaveBeenCalled();
    });

    it("expired attempt (unpaid past the limit): closes it after checking and starts a new one", async () => {
        const old = makeAttempt("pending", { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
        getBlockingAttempts.mockResolvedValue([old]);
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: old });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(paystackVerify).toHaveBeenCalledWith(OLD_REF);
        expect(expire).toHaveBeenCalledWith(old._id);
        expect(reserve).toHaveBeenCalledTimes(1);
        expect(paystackInitialize).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(body(res).data.resumed).toBe(false);
        expect(body(res).data.reference).toBe(NEW_REF);
    });

    it("recent pending attempt is resumed, not expired", async () => {
        const recent = makeAttempt("pending", { createdAt: new Date(Date.now() - 10 * 60 * 1000) });
        getBlockingAttempts.mockResolvedValue([recent]);
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: recent });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(expire).not.toHaveBeenCalled();
        expect(body(res).data.resumed).toBe(true);
        expect(reserve).not.toHaveBeenCalled();
    });

    it("expired-attempt that is paid at Paystack is settled, never expired", async () => {
        const old = makeAttempt("pending", { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
        getBlockingAttempts.mockResolvedValue([old]);
        paystackVerify.mockResolvedValue(makeVerification("success"));
        bookingFindOneAndUpdate.mockResolvedValue({
            ...makeBooking(),
            status: "confirmed",
            paymentStatus: "paid",
            paymentReference: OLD_REF,
        });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(expire).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("ALREADY_PAID");
        expect(reserve).not.toHaveBeenCalled();
    });

    it("expiry loses a race to a payment that just landed: asks the customer to retry", async () => {
        const old = makeAttempt("pending", { createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000) });
        getBlockingAttempts.mockResolvedValue([old]);
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: old });
        expire.mockResolvedValue(null);
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("PAYMENT_IN_PROGRESS");
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("retry after successful payment is rejected without any external call", async () => {
        getBlockingAttempts.mockResolvedValue([makeAttempt("success")]);
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res)).toEqual(expect.objectContaining({ success: false, code: "ALREADY_PAID" }));
        expect(paystackVerify).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("earlier pending attempt turns out to be paid: settles it and does not start another", async () => {
        const pending = makeAttempt("pending");
        getBlockingAttempts.mockResolvedValue([pending]);
        paystackVerify.mockResolvedValue(makeVerification("success"));
        bookingFindOneAndUpdate.mockResolvedValue({
            ...makeBooking(),
            status: "confirmed",
            paymentStatus: "paid",
            paymentReference: OLD_REF,
        });
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(bookingFindOneAndUpdate).toHaveBeenCalledTimes(1);
        expect(recordOutcome).toHaveBeenCalledWith(OLD_REF, expect.objectContaining({ providerStatus: "success" }), "verify");
        expect(res.status).toHaveBeenCalledWith(409);
        expect(body(res).code).toBe("ALREADY_PAID");
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("Paystack verification unavailable: blocks and changes nothing", async () => {
        getBlockingAttempts.mockResolvedValue([makeAttempt("pending")]);
        paystackVerify.mockRejectedValue(new Error("network down"));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(body(res).code).toBe("VERIFICATION_UNAVAILABLE");
        expect(recordOutcome).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("expired attempt does not block a new one", async () => {
        getBlockingAttempts.mockResolvedValue([makeAttempt("expired")]);
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(paystackVerify).not.toHaveBeenCalled();
        expect(reserve).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it("attempt still being set up or under review is rejected", async () => {
        getBlockingAttempts.mockResolvedValueOnce([makeAttempt("initiating")]);
        const first = makeRes();
        await initializePayment(initReq(), first);
        expect(first.status).toHaveBeenCalledWith(409);
        expect(body(first).code).toBe("PAYMENT_IN_PROGRESS");

        getBlockingAttempts.mockResolvedValueOnce([makeAttempt("unknown")]);
        const second = makeRes();
        await initializePayment(initReq(), second);
        expect(second.status).toHaveBeenCalledWith(409);
        expect(body(second).code).toBe("PAYMENT_UNDER_REVIEW");

        expect(paystackInitialize).not.toHaveBeenCalled();
    });

    it("two simultaneous requests: only one reaches Paystack", async () => {
        reserve
            .mockResolvedValueOnce({
                conflict: false,
                attempt: { _id: { toString: () => "attempt-new" }, reference: NEW_REF },
            })
            .mockResolvedValueOnce({ conflict: true, attempt: null });
        const resA = makeRes();
        const resB = makeRes();

        await Promise.all([initializePayment(initReq(), resA), initializePayment(initReq(), resB)]);

        expect(paystackInitialize).toHaveBeenCalledTimes(1);
        const statuses = [resA.status.mock.calls[0][0], resB.status.mock.calls[0][0]].sort();
        expect(statuses).toEqual([200, 409]);
        const rejected = resA.status.mock.calls[0][0] === 409 ? resA : resB;
        expect(body(rejected).code).toBe("PAYMENT_IN_PROGRESS");
    });

    it("Paystack initialization failure closes the attempt so the customer can retry", async () => {
        paystackInitialize.mockRejectedValue(new Error("boom"));
        const res = makeRes();

        await initializePayment(initReq(), res);

        expect(markInitializationFailed).toHaveBeenCalledWith(expect.anything(), "boom");
        expect(markPending).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe("verifyPayment attempts", () => {
    it("records a failed outcome and reports PAYMENT_FAILED", async () => {
        findByReference.mockResolvedValue(makeAttempt("pending"));
        paystackVerify.mockResolvedValue(makeVerification("failed"));
        const res = makeRes();

        await verifyPayment(verifyReq(OLD_REF), res);

        expect(recordOutcome).toHaveBeenCalledWith(OLD_REF, expect.objectContaining({ providerStatus: "failed" }), "verify");
        expect(res.status).toHaveBeenCalledWith(400);
        expect(body(res)).toEqual(expect.objectContaining({ success: false, code: "PAYMENT_FAILED", status: "failed" }));
    });

    it("an abandoned transaction is reported as not completed, not failed", async () => {
        findByReference.mockResolvedValue(makeAttempt("pending"));
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        const res = makeRes();

        await verifyPayment(verifyReq(OLD_REF), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(body(res).code).toBe("PAYMENT_NOT_COMPLETED");
    });

    it("verification unavailable: 503 and the attempt status is left alone", async () => {
        findByReference.mockResolvedValue(makeAttempt("pending"));
        paystackVerify.mockRejectedValue(new Error("network down"));
        const res = makeRes();

        await verifyPayment(verifyReq(OLD_REF), res);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(body(res).code).toBe("VERIFICATION_UNAVAILABLE");
        expect(recordOutcome).toHaveBeenCalledWith(OLD_REF, { providerStatus: null }, "verify");
    });

    it("falls back to the booking's stored reference for payments that predate attempts", async () => {
        findByReference.mockResolvedValue(null);
        bookingFindOne.mockResolvedValue(makeBooking({ paymentReference: "BK-TEST123456" }));
        paystackVerify.mockResolvedValue(makeVerification("abandoned", { reference: "BK-TEST123456" }));
        const res = makeRes();

        await verifyPayment(verifyReq("BK-TEST123456"), res);

        expect(bookingFindOne).toHaveBeenCalledWith({ paymentReference: "BK-TEST123456", userId: "user-1" });
        expect(recordOutcome).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it("a late payment on an older attempt flags it as a duplicate when another attempt already paid", async () => {
        const lateAttempt = makeAttempt("expired", { reference: OLD_REF });
        findByReference.mockResolvedValue(lateAttempt);
        bookingFindOne.mockResolvedValue(makeBooking({ status: "confirmed", paymentStatus: "paid", paymentReference: NEW_REF }));
        paystackVerify.mockResolvedValue(makeVerification("success"));
        const res = makeRes();

        await verifyPayment(verifyReq(OLD_REF), res);

        expect(recordOutcome).toHaveBeenCalledWith(OLD_REF, expect.objectContaining({ providerStatus: "success" }), "verify");
        expect(flagDuplicatePayment).toHaveBeenCalledWith(lateAttempt._id);
    });
});

describe("webhook and verify reporting the same success", () => {
    it("settle the booking once and neither fails or flags a duplicate", async () => {
        const attempt = makeAttempt("pending");
        const unpaid = makeBooking({ paymentReference: OLD_REF });
        const paid = makeBooking({ status: "confirmed", paymentStatus: "paid", paymentReference: OLD_REF });
        let claimed = false;

        findByReference.mockResolvedValue(attempt);
        bookingFindOne.mockResolvedValue(unpaid);
        bookingFindById.mockImplementation(async () => (claimed ? paid : unpaid));
        bookingFindOneAndUpdate.mockImplementation(async () => {
            if (claimed) return null;
            claimed = true;
            return paid;
        });
        paystackVerify.mockResolvedValue(makeVerification("success"));
        verifyWebhookSignature.mockReturnValue(true);

        const verifyRes = makeRes();
        const webhookRes = makeRes();

        await Promise.all([
            verifyPayment(verifyReq(OLD_REF), verifyRes),
            paystackWebhook(webhookReq(OLD_REF), webhookRes),
        ]);

        expect(verifyRes.status).toHaveBeenCalledWith(200);
        expect(webhookRes.status).toHaveBeenCalledWith(200);
        expect(bookingFindOneAndUpdate).toHaveBeenCalledTimes(2);
        expect(confirmWithProvider).not.toHaveBeenCalled();
        expect(flagDuplicatePayment).not.toHaveBeenCalled();
        expect(recordOutcome).toHaveBeenCalledTimes(2);
        expect(recordOutcome).toHaveBeenCalledWith(OLD_REF, expect.objectContaining({ providerStatus: "success" }), "webhook");
        expect(recordOutcome).toHaveBeenCalledWith(OLD_REF, expect.objectContaining({ providerStatus: "success" }), "verify");
    });
});