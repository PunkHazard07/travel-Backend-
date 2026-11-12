import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const findOne = jest.fn<(...args: any[]) => Promise<any>>();
const paystackInitialize = jest.fn<(...args: any[]) => Promise<any>>();
const refreshPrebookIfStale = jest.fn<(...args: any[]) => Promise<any>>();
const convertForCheckout = jest.fn<(...args: any[]) => Promise<number>>();
const bookingUpdateOne = jest.fn<(...args: any[]) => Promise<any>>();
const getBlockingAttempts = jest.fn<(...args: any[]) => Promise<any[]>>();
const reserve = jest.fn<(...args: any[]) => Promise<any>>();
const markPending = jest.fn<(...args: any[]) => Promise<any>>();
const markInitializationFailed = jest.fn<(...args: any[]) => Promise<any>>();
const recordOutcome = jest.fn<(...args: any[]) => Promise<any>>();
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
    default: { findOne, findOneAndUpdate: jest.fn(), findById: jest.fn(), updateOne: bookingUpdateOne },
}));
jest.unstable_mockModule("../Config/paystackService.js", () => ({
    paystackService: { initializePayment: paystackInitialize },
}));
jest.unstable_mockModule("../Config/paymentAttemptService.js", () => ({
    paymentAttemptService: {
        getBlockingAttempts,
        reserve,
        markPending,
        markInitializationFailed,
        recordOutcome,
        findByReference,
        flagDuplicatePayment,
    },
}));
jest.unstable_mockModule("../Config/bookingService.js", () => ({
    bookingService: { refreshPrebookIfStale },
    BookingError: MockBookingError,
}));
jest.unstable_mockModule("../utils/currencyConverter.js", () => ({
    convertForCheckout,
}));

const { initializePayment } = await import("../Controller/paymentController.js");
const { checkPaymentEligibility } = await import("../utils/paymentEligibility.js");

const makeBooking = (status: string, paymentStatus: string, overrides: Record<string, any> = {}) => ({
    _id: { toString: () => "booking-1" },
    bookingType: "flight",
    bookingReference: "BK-TEST123456",
    totalPrice: 100,
    flightData: { price: { currency: "NGN" } },
    status,
    paymentStatus,
    set: jest.fn(),
    save: jest.fn(async () => undefined),
    ...overrides,
});

const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
};

const makeReq = () =>
    ({
        body: { bookingId: "booking-1" },
        user: { id: "user-1", email: "ada@example.com" },
    }) as any;

beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    paystackInitialize.mockResolvedValue({
        reference: "ref-1",
        authorizationUrl: "https://paystack.test/auth",
        accessCode: "access-1",
    });
    refreshPrebookIfStale.mockResolvedValue({ priceChanged: false });
    convertForCheckout.mockResolvedValue(100);
    getBlockingAttempts.mockResolvedValue([]);
    reserve.mockResolvedValue({
        conflict: false,
        attempt: { _id: { toString: () => "attempt-1" }, reference: "ref-1" },
    });
    markPending.mockResolvedValue({});
    bookingUpdateOne.mockResolvedValue({});
});

describe("checkPaymentEligibility", () => {
    const cases: Array<[string, string, boolean]> = [
        ["pending", "unpaid", true],
        ["pending", "processing", false],
        ["pending", "flagged", false],
        ["pending", "refunded", false],
        ["confirmed", "unpaid", false],
        ["failed", "unpaid", false],
        ["cancelled", "unpaid", false],
        ["pending", "paid", false],
    ];

    it.each(cases)("%s + %s -> eligible: %s", (status, paymentStatus, expected) => {
        expect(checkPaymentEligibility({ status: status as any, paymentStatus: paymentStatus as any }).eligible).toBe(
            expected
        );
    });

    it("rejects unknown future values (allowlist, not denylist)", () => {
        expect(
            checkPaymentEligibility({ status: "on_hold" as any, paymentStatus: "unpaid" }).eligible
        ).toBe(false);
        expect(
            checkPaymentEligibility({ status: "pending", paymentStatus: "disputed" as any }).eligible
        ).toBe(false);
    });
});

describe("initializePayment eligibility gate", () => {
    it("proceeds for pending + unpaid", async () => {
        findOne.mockResolvedValue(makeBooking("pending", "unpaid"));
        const res = makeRes();

        await initializePayment(makeReq(), res);

        expect(paystackInitialize).toHaveBeenCalledTimes(1);
        expect(paystackInitialize.mock.calls[0][2]).toBe("ref-1");
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                success: true,
                data: expect.objectContaining({ reference: "ref-1" }),
            })
        );
    });

    const rejected: Array<[string, string]> = [
        ["pending", "processing"],
        ["pending", "flagged"],
        ["pending", "refunded"],
        ["confirmed", "unpaid"],
        ["failed", "unpaid"],
        ["cancelled", "unpaid"],
        ["pending", "paid"],
    ];

    it.each(rejected)("rejects %s + %s without any external call", async (status, paymentStatus) => {
        const booking = makeBooking(status, paymentStatus, {
            bookingType: "flight",
            flightData: { price: { currency: "USD" } },
        });
        findOne.mockResolvedValue(booking);
        const res = makeRes();

        await initializePayment(makeReq(), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ success: false, code: expect.any(String) })
        );
        expect(convertForCheckout).not.toHaveBeenCalled();
        expect(refreshPrebookIfStale).not.toHaveBeenCalled();
        expect(getBlockingAttempts).not.toHaveBeenCalled();
        expect(reserve).not.toHaveBeenCalled();
        expect(paystackInitialize).not.toHaveBeenCalled();
        expect(booking.save).not.toHaveBeenCalled();
    });
});