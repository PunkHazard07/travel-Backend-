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
        expect(first.attempt?.reference).toMatch(/^BK-TEST123456-[0-9A-F]{16}$/);
        expect(first.attempt?.reference).not.toBe(second.attempt?.reference);
    });

    it("reports a conflict when the one-active-attempt index rejects the insert", async () => {
        create.mockRejectedValue(Object.assign(new Error("E11000 duplicate key"), { code: 11000 }));

        const result = await paymentAttemptService.reserve(input);

        expect(result).toEqual({ conflict: true, attempt: null });
    });

    it("retries with a new reference when only the random reference collided", async () => {
        create
            .mockRejectedValueOnce(Object.assign(new Error("E11000"), { code: 11000, keyPattern: { reference: 1 } }))
            .mockImplementation(async (doc: any) => doc);

        const result = await paymentAttemptService.reserve(input);

        expect(result.conflict).toBe(false);
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[0][0].reference).not.toBe(create.mock.calls[1][0].reference);
    });

    it("a conflict on the booking index is a real conflict and is not retried", async () => {
        create.mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000, keyPattern: { bookingId: 1 } }));

        expect(await paymentAttemptService.reserve(input)).toEqual({ conflict: true, attempt: null });
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("gives up after repeated reference collisions rather than looping forever", async () => {
        create.mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000, keyPattern: { reference: 1 } }));

        await expect(paymentAttemptService.reserve(input)).rejects.toThrow("unique payment reference");
        expect(create).toHaveBeenCalledTimes(3);
    });

    it("does not hide other database errors", async () => {
        create.mockRejectedValue(new Error("connection lost"));

        await expect(paymentAttemptService.reserve(input)).rejects.toThrow("connection lost");
    });
});

describe("getBlockingAttempts", () => {
    it("only asks for paid and still-open attempts, newest first", async () => {
        const sort = (jest.fn() as any).mockResolvedValue([]);
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

describe("noteInitializationUncertain", () => {
    it("records the reason but leaves the status as initiating", async () => {
        updateOne.mockResolvedValue({});

        await paymentAttemptService.noteInitializationUncertain("attempt-1", "timeout");

        const [filter, update] = updateOne.mock.calls[0];
        expect(filter).toEqual({ _id: "attempt-1", status: "initiating" });
        expect(update.$set.failureReason).toContain("initialization_unconfirmed");
        expect(update.$set.status).toBeUndefined();
    });
});

describe("closeUnreachable", () => {
    it("closes only an attempt that has no checkout link, as failed and inactive", async () => {
        findOneAndUpdate.mockResolvedValue({ status: "failed" });

        await paymentAttemptService.closeUnreachable("attempt-1");

        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ _id: "attempt-1", status: { $in: ["initiating", "pending"] }, authorizationUrl: null });
        expect(update.$set).toEqual(
            expect.objectContaining({ status: "failed", isActive: false, failureReason: "link_never_delivered" })
        );
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
        const limit = (jest.fn() as any).mockResolvedValue([]);
        const sort = jest.fn().mockReturnValue({ limit });
        find.mockReturnValue({ sort });
        const initiatingBefore = new Date("2026-11-10T11:50:00.000Z");
        const recheckBefore = new Date("2026-11-10T11:55:00.000Z");
        const expiredAfter = new Date("2026-11-09T12:00:00.000Z");

        await paymentAttemptService.findStaleAttempts({ initiatingBefore, recheckBefore, expiredAfter, limit: 50 });

        const [filter] = find.mock.calls[0];
        const notCheckedSince = [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: recheckBefore } }];
        expect(filter.$or[0]).toEqual({ isActive: true, status: "initiating", createdAt: { $lt: initiatingBefore } });
        expect(filter.$or[1].isActive).toBe(true);
        expect(filter.$or[1].status.$in).toEqual(["pending", "unknown"]);
        expect(filter.$or[1].createdAt).toEqual({ $lt: recheckBefore });
        expect(filter.$or[1].$or).toEqual(notCheckedSince);
        // recently expired attempts are re-checked too, within the window only
        expect(filter.$or[2]).toEqual({ status: "expired", verifiedAt: { $gt: expiredAfter }, $or: notCheckedSince });
        expect(sort).toHaveBeenCalledWith({ createdAt: 1 });
        expect(limit).toHaveBeenCalledWith(50);
    });
});