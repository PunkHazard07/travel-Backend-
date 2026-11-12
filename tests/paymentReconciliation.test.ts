import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

const bookingFindById = jest.fn<(...args: any[]) => Promise<any>>();
const paystackVerify = jest.fn<(...args: any[]) => Promise<any>>();
const recordOutcome = jest.fn<(...args: any[]) => Promise<any>>();
const expire = jest.fn<(...args: any[]) => Promise<any>>();
const markInitializationFailed = jest.fn<(...args: any[]) => Promise<any>>();
const flagDuplicatePayment = jest.fn<(...args: any[]) => Promise<any>>();
const findStaleAttempts = jest.fn<(...args: any[]) => Promise<any[]>>();
const settleAttemptPayment = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../Model/booking.js", () => ({
    __esModule: true,
    default: { findById: bookingFindById },
}));
jest.unstable_mockModule("../Config/paystackService.js", () => ({
    paystackService: { verifyPayment: paystackVerify },
}));
jest.unstable_mockModule("../Config/paymentAttemptService.js", () => ({
    paymentAttemptService: {
        recordOutcome,
        expire,
        markInitializationFailed,
        flagDuplicatePayment,
        findStaleAttempts,
    },
}));
jest.unstable_mockModule("../Config/paymentSettlement.js", () => ({
    settleAttemptPayment,
    toOutcomeInput: (payment: any) => ({ providerStatus: payment.status }),
}));

const {
    reconcileAttempt,
    reconcileStaleAttempts,
    startPaymentReconciliationSchedule,
    stopPaymentReconciliationSchedule,
} = await import("../Config/paymentReconciliation.js");
const policy = await import("../utils/paymentAttemptPolicy.js");

const MINUTE = 60 * 1000;
const NOW = new Date("2026-11-10T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * MINUTE);

const makeAttempt = (status: string, ageMinutes: number, overrides: Record<string, any> = {}) => ({
    _id: { toString: () => `attempt-${status}-${ageMinutes}` },
    bookingId: "booking-1",
    reference: `BK-TEST-${status.toUpperCase()}-${ageMinutes}`,
    status,
    createdAt: minutesAgo(ageMinutes),
    ...overrides,
});

const makeVerification = (status: string) => ({
    success: status === "success",
    status,
    amount: 100,
    reference: "ref",
    paidAt: "2026-11-10T11:00:00.000Z",
    channel: "card",
});

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    recordOutcome.mockResolvedValue({ found: true, applied: false, attempt: null });
    expire.mockResolvedValue({ status: "expired" });
    markInitializationFailed.mockResolvedValue(undefined);
    flagDuplicatePayment.mockResolvedValue(undefined);
    settleAttemptPayment.mockResolvedValue({ paymentStatus: "paid" });
    findStaleAttempts.mockResolvedValue([]);
});

describe("payment attempt policy", () => {
    it("pending attempts expire at the limit, not before", () => {
        expect(policy.isPendingAttemptExpired({ createdAt: minutesAgo(59) }, NOW)).toBe(false);
        expect(policy.isPendingAttemptExpired({ createdAt: minutesAgo(60) }, NOW)).toBe(true);
        expect(policy.isPendingAttemptExpired({ createdAt: minutesAgo(600) }, NOW)).toBe(true);
    });

    it("initiating attempts go stale at the limit, not before", () => {
        expect(policy.isInitiatingAttemptStale({ createdAt: minutesAgo(9) }, NOW)).toBe(false);
        expect(policy.isInitiatingAttemptStale({ createdAt: minutesAgo(10) }, NOW)).toBe(true);
    });

    it("an unknown or invalid age is never treated as stale", () => {
        expect(policy.isPendingAttemptExpired({}, NOW)).toBe(false);
        expect(policy.isPendingAttemptExpired({ createdAt: null }, NOW)).toBe(false);
        expect(policy.isPendingAttemptExpired({ createdAt: "not a date" }, NOW)).toBe(false);
        expect(policy.isInitiatingAttemptStale({}, NOW)).toBe(false);
    });
});

describe("reconcileAttempt: pending", () => {
    it("paid at Paystack but webhook missed: settles the booking", async () => {
        const attempt = makeAttempt("pending", 20);
        const booking = { _id: "booking-1", paymentStatus: "unpaid" };
        paystackVerify.mockResolvedValue(makeVerification("success"));
        bookingFindById.mockResolvedValue(booking);

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("settled");
        expect(settleAttemptPayment).toHaveBeenCalledWith(booking, attempt, expect.objectContaining({ success: true }), "reconcile");
        expect(expire).not.toHaveBeenCalled();
    });

    it("failed at Paystack: records the failure and closes", async () => {
        const attempt = makeAttempt("pending", 20);
        paystackVerify.mockResolvedValue(makeVerification("failed"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: { ...attempt, status: "failed" } });

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("closed_failed");
        expect(recordOutcome).toHaveBeenCalledWith(attempt.reference, expect.objectContaining({ providerStatus: "failed" }), "reconcile");
        expect(expire).not.toHaveBeenCalled();
    });

    it("unpaid and older than the limit: expires it after checking", async () => {
        const attempt = makeAttempt("pending", 120);
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt });

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("expired");
        expect(paystackVerify).toHaveBeenCalledWith(attempt.reference);
        expect(expire).toHaveBeenCalledWith(attempt._id);
    });

    it("unpaid but still within the limit: leaves it pending", async () => {
        const attempt = makeAttempt("pending", 20);
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt });

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("still_pending");
        expect(expire).not.toHaveBeenCalled();
    });

    it("Paystack unreachable: never expires, even an old attempt", async () => {
        const attempt = makeAttempt("pending", 600);
        paystackVerify.mockRejectedValue(new Error("network down"));

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("verification_unavailable");
        expect(recordOutcome).toHaveBeenCalledWith(attempt.reference, { providerStatus: null }, "reconcile");
        expect(expire).not.toHaveBeenCalled();
        expect(settleAttemptPayment).not.toHaveBeenCalled();
    });

    it("expiry loses the race to a payment that just landed: reports skipped", async () => {
        const attempt = makeAttempt("pending", 120);
        paystackVerify.mockResolvedValue(makeVerification("abandoned"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt });
        expire.mockResolvedValue(null);

        expect(await reconcileAttempt(attempt as any, NOW)).toBe("skipped");
    });

    it("paid, but the booking no longer exists: records it and flags for a person", async () => {
        const attempt = makeAttempt("pending", 20);
        paystackVerify.mockResolvedValue(makeVerification("success"));
        bookingFindById.mockResolvedValue(null);

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("needs_review");
        expect(recordOutcome).toHaveBeenCalledWith(attempt.reference, expect.objectContaining({ providerStatus: "success" }), "reconcile");
        expect(flagDuplicatePayment).toHaveBeenCalledWith(attempt._id);
        expect(settleAttemptPayment).not.toHaveBeenCalled();
    });
});

describe("reconcileAttempt: initiating and unknown", () => {
    it("stale initiating (customer never got a link): closes as failed without calling Paystack", async () => {
        const attempt = makeAttempt("initiating", 15);

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("closed_failed");
        expect(markInitializationFailed).toHaveBeenCalledWith(attempt._id, "stale_initiating");
        expect(paystackVerify).not.toHaveBeenCalled();
    });

    it("recent initiating: another request is probably mid-setup, so leave it", async () => {
        const attempt = makeAttempt("initiating", 2);

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("skipped");
        expect(markInitializationFailed).not.toHaveBeenCalled();
        expect(paystackVerify).not.toHaveBeenCalled();
    });

    it("unknown that is still reversed: never auto-closed, left for review", async () => {
        const attempt = makeAttempt("unknown", 300);
        paystackVerify.mockResolvedValue(makeVerification("reversed"));
        recordOutcome.mockResolvedValue({ found: true, applied: false, attempt });

        const action = await reconcileAttempt(attempt as any, NOW);

        expect(action).toBe("needs_review");
        expect(expire).not.toHaveBeenCalled();
    });

    it("unknown that turns out to be paid: settles", async () => {
        const attempt = makeAttempt("unknown", 300);
        paystackVerify.mockResolvedValue(makeVerification("success"));
        bookingFindById.mockResolvedValue({ _id: "booking-1" });

        expect(await reconcileAttempt(attempt as any, NOW)).toBe("settled");
        expect(settleAttemptPayment).toHaveBeenCalledTimes(1);
    });
});

describe("reconcileStaleAttempts", () => {
    it("asks for stale attempts using the policy thresholds and batch size", async () => {
        await reconcileStaleAttempts(NOW);

        const options = findStaleAttempts.mock.calls[0][0];
        expect(options.initiatingBefore).toEqual(new Date(NOW.getTime() - policy.INITIATING_ATTEMPT_MAX_AGE_MS));
        expect(options.recheckBefore).toEqual(new Date(NOW.getTime() - policy.ATTEMPT_RECHECK_INTERVAL_MS));
        expect(options.limit).toBe(policy.RECONCILE_BATCH_SIZE);
    });

    it("one failing attempt does not stop the rest, and the summary counts everything", async () => {
        const paid = makeAttempt("pending", 30);
        const waiting = makeAttempt("pending", 20);
        const stale = makeAttempt("initiating", 15);
        findStaleAttempts.mockResolvedValue([paid, waiting, stale]);

        paystackVerify.mockImplementation(async (reference: string) =>
            reference === paid.reference ? makeVerification("success") : makeVerification("abandoned")
        );
        bookingFindById.mockResolvedValue({ _id: "booking-1" });
        settleAttemptPayment.mockRejectedValue(new Error("database hiccup"));
        recordOutcome.mockResolvedValue({ found: true, applied: true, attempt: waiting });

        const summary = await reconcileStaleAttempts(NOW);

        expect(summary.checked).toBe(3);
        expect(summary.counts.error).toBe(1);
        expect(summary.counts.still_pending).toBe(1);
        expect(summary.counts.closed_failed).toBe(1);
        expect(markInitializationFailed).toHaveBeenCalledWith(stale._id, "stale_initiating");
    });
});

describe("startPaymentReconciliationSchedule", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        stopPaymentReconciliationSchedule();
        jest.useRealTimers();
    });

    it("runs one pass per interval and starting twice does not double it", () => {
        startPaymentReconciliationSchedule();
        startPaymentReconciliationSchedule();

        jest.advanceTimersByTime(policy.RECONCILE_INTERVAL_MS);

        expect(findStaleAttempts).toHaveBeenCalledTimes(1);
    });

    it("does not start a new pass while the previous one is still running", () => {
        findStaleAttempts.mockReturnValue(new Promise<any[]>(() => undefined));
        startPaymentReconciliationSchedule();

        jest.advanceTimersByTime(policy.RECONCILE_INTERVAL_MS);
        jest.advanceTimersByTime(policy.RECONCILE_INTERVAL_MS);

        expect(findStaleAttempts).toHaveBeenCalledTimes(1);
    });

    it("stops running after it is stopped", () => {
        startPaymentReconciliationSchedule();
        stopPaymentReconciliationSchedule();

        jest.advanceTimersByTime(policy.RECONCILE_INTERVAL_MS * 3);

        expect(findStaleAttempts).not.toHaveBeenCalled();
    });
});