import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import PaymentAttempt, { ATTEMPT_STATUSES, type AttemptStatus } from "../Model/paymentAttempt.js";
import {
    canTransition,
    decideTransition,
    paymentAttemptService,
} from "../Config/paymentAttemptService.js";

const findOneAndUpdate = jest.spyOn(PaymentAttempt, "findOneAndUpdate") as any;

const attemptDoc = (status: AttemptStatus, extra: Record<string, any> = {}) => ({
    reference: "BK-TEST-1A2B3C4D",
    status,
    isActive: ["initiating", "pending", "unknown"].includes(status),
    ...extra,
});

beforeEach(() => {
    findOneAndUpdate.mockReset();
});

describe("canTransition", () => {
    const allowed: Array<[AttemptStatus, string, boolean]> = [
        ["pending", "success", true],
        ["initiating", "success", true],
        ["unknown", "success", true],
        ["failed", "success", true],
        ["expired", "success", true],
        ["success", "success", false],

        ["pending", "failed", true],
        ["initiating", "failed", true],
        ["unknown", "failed", true],
        ["success", "failed", false],
        ["failed", "failed", false],
        ["expired", "failed", false],

        ["pending", "abandoned", true],
        ["unknown", "abandoned", true],
        ["success", "abandoned", false],
        ["failed", "abandoned", false],
        ["expired", "abandoned", false],

        ["pending", "ongoing", true],
        ["pending", "processing", true],
        ["pending", "queued", true],
        ["success", "pending", false],
        ["expired", "pending", false],

        ["pending", "reversed", true],
        ["success", "reversed", false],
        ["expired", "reversed", false],
        ["unknown", "reversed", false],
    ];

    it.each(allowed)("%s + provider %s -> %s", (current, providerStatus, expected) => {
        expect(canTransition(current, providerStatus)).toBe(expected);
    });

    it("ignores unrecognised or missing provider statuses", () => {
        for (const status of ATTEMPT_STATUSES) {
            expect(canTransition(status, "something_new")).toBe(false);
            expect(canTransition(status, null)).toBe(false);
            expect(canTransition(status, undefined)).toBe(false);
        }
    });

    it("never reopens a closed attempt to an active status", () => {
        for (const providerStatus of ["abandoned", "ongoing", "pending", "processing", "queued", "reversed"]) {
            for (const closed of ["failed", "expired", "success"] as AttemptStatus[]) {
                expect(canTransition(closed, providerStatus)).toBe(false);
            }
        }
    });

    it("is case-insensitive", () => {
        expect(decideTransition("SUCCESS")?.next).toBe("success");
    });
});

describe("recordOutcome", () => {
    it("records success with payment details", async () => {
        findOneAndUpdate.mockResolvedValueOnce(attemptDoc("success"));

        const result = await paymentAttemptService.recordOutcome(
            "BK-TEST-1A2B3C4D",
            { providerStatus: "success", amount: 5000, channel: "card", paidAt: "2026-11-05T21:00:00.000Z", gatewayResponse: "Successful" },
            "webhook"
        );

        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter.reference).toBe("BK-TEST-1A2B3C4D");
        expect(filter.status.$in).not.toContain("success");
        expect(update.$set).toEqual(
            expect.objectContaining({
                status: "success",
                isActive: false,
                paidAmount: 5000,
                channel: "card",
                resolvedBy: "webhook",
                providerStatus: "success",
            })
        );
        expect(update.$set.paidAt).toBeInstanceOf(Date);
        expect(result).toEqual(expect.objectContaining({ found: true, applied: true }));
    });

    it("records failed only from open statuses", async () => {
        findOneAndUpdate.mockResolvedValueOnce(attemptDoc("failed"));

        await paymentAttemptService.recordOutcome(
            "BK-TEST-1A2B3C4D",
            { providerStatus: "failed", gatewayResponse: "Insufficient funds" },
            "verify"
        );

        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter.status.$in).toEqual(expect.arrayContaining(["initiating", "pending", "unknown"]));
        expect(filter.status.$in).not.toContain("success");
        expect(filter.status.$in).not.toContain("expired");
        expect(filter.status.$in).not.toContain("failed");
        expect(update.$set).toEqual(
            expect.objectContaining({ status: "failed", isActive: false, failureReason: "Insufficient funds", resolvedBy: "verify" })
        );
    });

    it("keeps an abandoned transaction pending and active", async () => {
        findOneAndUpdate.mockResolvedValueOnce(attemptDoc("pending"));

        await paymentAttemptService.recordOutcome(
            "BK-TEST-1A2B3C4D",
            { providerStatus: "abandoned", gatewayResponse: "The transaction was not completed" },
            "verify"
        );

        const [, update] = findOneAndUpdate.mock.calls[0];
        expect(update.$set).toEqual(
            expect.objectContaining({ status: "pending", isActive: true, providerStatus: "abandoned" })
        );
        expect(update.$set.resolvedBy).toBeUndefined();
        expect(update.$set.verifiedAt).toBeUndefined();
    });

    it("moves a reversed transaction to unknown for review", async () => {
        findOneAndUpdate.mockResolvedValueOnce(attemptDoc("unknown"));

        await paymentAttemptService.recordOutcome("BK-TEST-1A2B3C4D", { providerStatus: "reversed" }, "reconcile");

        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter.status.$in).toEqual(["initiating", "pending"]);
        expect(update.$set).toEqual(
            expect.objectContaining({ status: "unknown", isActive: true, failureReason: "reversed_or_chargeback" })
        );
    });

    it("does not change status when verification was unavailable", async () => {
        findOneAndUpdate.mockResolvedValueOnce(attemptDoc("pending"));

        const result = await paymentAttemptService.recordOutcome("BK-TEST-1A2B3C4D", { providerStatus: null }, "reconcile");

        expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
        const [filter, update] = findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ reference: "BK-TEST-1A2B3C4D" });
        expect(update.$set.status).toBeUndefined();
        expect(update.$set.isActive).toBeUndefined();
        expect(update.$set.lastCheckedAt).toBeInstanceOf(Date);
        expect(result).toEqual(expect.objectContaining({ found: true, applied: false }));
    });

    it("reports a missing attempt without throwing", async () => {
        findOneAndUpdate.mockResolvedValue(null);

        const result = await paymentAttemptService.recordOutcome("BK-NOPE", { providerStatus: "success" }, "webhook");

        expect(result).toEqual({ found: false, applied: false, attempt: null });
    });

    it("webhook and verify reporting the same success: first applies, second is a no-op", async () => {
        const success = attemptDoc("success");
        findOneAndUpdate
            .mockResolvedValueOnce(success) // webhook wins the conditional update
            .mockResolvedValueOnce(null)    // verify: guard (status != success) matches nothing
            .mockResolvedValueOnce(success); // verify: lastCheckedAt-only touch

        const payment = { providerStatus: "success", amount: 5000, channel: "card", paidAt: "2026-11-05T21:00:00.000Z" };
        const [fromWebhook, fromVerify] = await Promise.all([
            paymentAttemptService.recordOutcome("BK-TEST-1A2B3C4D", payment, "webhook"),
            paymentAttemptService.recordOutcome("BK-TEST-1A2B3C4D", payment, "verify"),
        ]);

        expect(fromWebhook.applied).toBe(true);
        expect(fromVerify.applied).toBe(false);
        expect(fromVerify.attempt?.status).toBe("success");
    });

    it("a stale failed result cannot overwrite a recorded success", async () => {
        findOneAndUpdate
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(attemptDoc("success"));

        const result = await paymentAttemptService.recordOutcome(
            "BK-TEST-1A2B3C4D",
            { providerStatus: "failed", gatewayResponse: "Declined" },
            "reconcile"
        );

        const [filter] = findOneAndUpdate.mock.calls[0];
        expect(filter.status.$in).not.toContain("success");
        expect(result.applied).toBe(false);
        expect(result.attempt?.status).toBe("success");
    });

    it("records a late success on an expired attempt", async () => {
        findOneAndUpdate.mockResolvedValueOnce(attemptDoc("success"));

        const result = await paymentAttemptService.recordOutcome(
            "BK-TEST-1A2B3C4D",
            { providerStatus: "success", amount: 5000 },
            "webhook"
        );

        const [filter] = findOneAndUpdate.mock.calls[0];
        expect(filter.status.$in).toContain("expired");
        expect(result.applied).toBe(true);
    });
});