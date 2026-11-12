import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import PaymentAttempt from "../Model/paymentAttempt.js";
import { paymentAttemptService } from "../Config/paymentAttemptService.js";

const create = jest.spyOn(PaymentAttempt, "create") as any;
const findOneAndUpdate = jest.spyOn(PaymentAttempt, "findOneAndUpdate") as any;
const updateOne = jest.spyOn(PaymentAttempt, "updateOne") as any;
const find = jest.spyOn(PaymentAttempt, "find") as any;

beforeEach(() => {
    create.mockReset();
    findOneAndUpdate.mockReset();
    updateOne.mockReset();
    find.mockReset();
});

describe("reserve", () => {
    const input = {
        bookingId: "booking-1",
        userId: "user-1",
        bookingReference: "BK-TEST123456",
        amount: 100,
        currency: "NGN",
    };

    it("creates an initiating attempt with a fresh unique reference", async () => {
        create.mockImplementation(async (doc: any) => doc);

        const first = await paymentAttemptService.reserve(input);
        const second = await paymentAttemptService.reserve(input);

        expect(first.conflict).toBe(false);
        expect(first.attempt).toEqual(expect.objectContaining({ status: "initiating", isActive: true, amount: 100, currency: "NGN" }));
        expect(first.attempt?.reference).toMatch(/^BK-TEST123456-[0-9A-F]{8}$/);
        expect(first.attempt?.reference).not.toBe(second.attempt?.reference);
    });

    it("reports a conflict when the one-active-attempt index rejects the insert", async () => {
        create.mockRejectedValue(Object.assign(new Error("E11000 duplicate key"), { code: 11000 }));

        const result = await paymentAttemptService.reserve(input);

        expect(result).toEqual({ conflict: true, attempt: null });
    });

    it("does not hide other database errors", async () => {
        create.mockRejectedValue(new Error("connection lost"));

        await expect(paymentAttemptService.reserve(input)).rejects.toThrow("connection lost");
    });
});

describe("getBlockingAttempts", () => {
    it("only asks for paid and still-open attempts, newest first", async () => {
        const sort = jest.fn<(options: Record<string, number>) => Promise<any[]>>().mockResolvedValue([]);
        find.mockReturnValue({ sort });

        await paymentAttemptService.getBlockingAttempts("booking-1");

        const [filter] = find.mock.calls[0];
        expect(filter.bookingId).toBe("booking-1");
        expect(filter.status.$in).toEqual(["success", "initiating", "pending", "unknown"]);
        expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
    });
});

describe("markPending and markInitializationFailed", () => {
    it("markPending only moves an attempt that is still initiating", async () => {
        findOneAndUpdate.mockResolvedValue({});

        await paymentAttemptService.markPending("attempt-1", { authorizationUrl: "https://paystack.test/x", accessCode: "code" });

        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ _id: "attempt-1", status: "initiating" });
        expect(update.$set).toEqual(
            expect.objectContaining({ status: "pending", isActive: true, authorizationUrl: "https://paystack.test/x", accessCode: "code" })
        );
    });

    it("markInitializationFailed closes only an initiating attempt, as failed and inactive", async () => {
        updateOne.mockResolvedValue({});

        await paymentAttemptService.markInitializationFailed("attempt-1", "boom");

        const [filter, update] = updateOne.mock.calls[0];
        expect(filter).toEqual({ _id: "attempt-1", status: "initiating" });
        expect(update.$set).toEqual(expect.objectContaining({ status: "failed", isActive: false }));
        expect(update.$set.failureReason).toContain("boom");
    });
});

describe("expire", () => {
    it("only expires an attempt that is still pending, and closes it", async () => {
        findOneAndUpdate.mockResolvedValue({ status: "expired" });

        await paymentAttemptService.expire("attempt-1");

        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ _id: "attempt-1", status: "pending" });
        expect(update.$set).toEqual(
            expect.objectContaining({ status: "expired", isActive: false, failureReason: "expired_unpaid", resolvedBy: "reconcile" })
        );
    });

    it("returns null when the attempt was already resolved by something else", async () => {
        findOneAndUpdate.mockResolvedValue(null);

        expect(await paymentAttemptService.expire("attempt-1")).toBeNull();
    });
});

describe("findStaleAttempts", () => {
    it("targets active attempts only, oldest first, within the batch limit", async () => {
        const limit = jest.fn<(value: number) => Promise<any[]>>().mockResolvedValue([]);
        const sort = jest.fn().mockReturnValue({ limit });
        find.mockReturnValue({ sort });
        const initiatingBefore = new Date("2026-11-10T11:50:00.000Z");
        const recheckBefore = new Date("2026-11-10T11:55:00.000Z");

        await paymentAttemptService.findStaleAttempts({ initiatingBefore, recheckBefore, limit: 50 });

        const [filter] = find.mock.calls[0];
        expect(filter.isActive).toBe(true);
        expect(filter.$or[0]).toEqual({ status: "initiating", createdAt: { $lt: initiatingBefore } });
        expect(filter.$or[1].status.$in).toEqual(["pending", "unknown"]);
        expect(filter.$or[1].createdAt).toEqual({ $lt: recheckBefore });
        expect(filter.$or[1].$or).toEqual([{ lastCheckedAt: null }, { lastCheckedAt: { $lt: recheckBefore } }]);
        expect(sort).toHaveBeenCalledWith({ createdAt: 1 });
        expect(limit).toHaveBeenCalledWith(50);
    });
});