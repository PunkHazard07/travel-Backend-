import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const bookingFind = jest.fn<(...args: any[]) => any>();
const bookingFindOneAndUpdate = jest.fn<(...args: any[]) => Promise<any>>();
const bookingFindById = jest.fn<(...args: any[]) => Promise<any>>();
const bookingUpdateOne = jest.fn<(...args: any[]) => Promise<any>>();
const confirmWithProvider = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../Model/booking.js", () => ({
    __esModule: true,
    default: {
        find: bookingFind,
        findOneAndUpdate: bookingFindOneAndUpdate,
        findById: bookingFindById,
        updateOne: bookingUpdateOne,
    },
}));
jest.unstable_mockModule("../Config/bookingService.js", () => ({
    bookingService: { confirmWithProvider },
}));

const { providerLookup, setProviderLookup } = await import("../utils/providerLookup.js");
const {
    recoverBooking,
    recoverStuckBookings,
    IN_PROGRESS_STALE_MS,
    UNKNOWN_RECHECK_MS,
    MAX_RESEND_ATTEMPTS,
    RECOVERY_BATCH_SIZE,
} = await import("../Config/fulfillmentRecovery.js");

const NOW = new Date("2026-11-24T12:00:00.000Z");

const makeBooking = (overrides: Record<string, any> = {}) =>
    ({
        _id: "booking-1",
        bookingType: "flight",
        bookingReference: "BK-TEST123456",
        status: "pending",
        paymentStatus: "paid",
        fulfillmentStatus: "unknown",
        fulfillmentAttempts: 1,
        providerBookingId: null,
        ...overrides,
    }) as any;

const lookupReturns = (result: any) => setProviderLookup({ find: jest.fn(async () => result) } as any);

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    bookingUpdateOne.mockResolvedValue({ acknowledged: true });
    bookingFindOneAndUpdate.mockImplementation(async (_filter: any, update: any) => ({ ...makeBooking(), ...update.$set }));
    bookingFindById.mockResolvedValue(makeBooking());
});

describe("default provider lookup", () => {
    it("is unsupported for flights, so a flight is never re-sent until a real Duffel lookup exists", async () => {
        const flight = await providerLookup.find(makeBooking({ bookingType: "flight" }));

        expect(flight.result).toBe("unsupported");
    });
});

describe("recoverBooking: nothing to do", () => {
    it.each([
        ["unpaid", { paymentStatus: "unpaid" }],
        ["flagged payment", { paymentStatus: "flagged" }],
        ["already confirmed", { fulfillmentStatus: "confirmed" }],
        ["already failed", { fulfillmentStatus: "failed" }],
        ["not started", { fulfillmentStatus: "not_started" }],
    ])("%s is skipped without asking the supplier", async (_name, overrides) => {
        const find = jest.fn(async () => ({ result: "not_found" }));
        setProviderLookup({ find } as any);

        const action = await recoverBooking(makeBooking(overrides), NOW);

        expect(action).toBe("skipped");
        expect(find).not.toHaveBeenCalled();
        expect(confirmWithProvider).not.toHaveBeenCalled();
    });
});

describe("recoverBooking: the supplier already has the reservation", () => {
    it("confirmed at the supplier: recorded as confirmed and NOT booked again", async () => {
        lookupReturns({ result: "found", providerStatus: "confirmed", providerBookingId: "ord_9", providerData: { source: "lookup" } });

        const action = await recoverBooking(makeBooking({ fulfillmentStatus: "in_progress" }), NOW);

        expect(action).toBe("confirmed_from_lookup");
        expect(confirmWithProvider).not.toHaveBeenCalled();
        const [filter, update] = bookingFindOneAndUpdate.mock.calls[0];
        expect(filter.fulfillmentStatus).toEqual({ $in: ["in_progress", "unknown"] });
        expect(update.$set).toMatchObject({ status: "confirmed", fulfillmentStatus: "confirmed", providerBookingId: "ord_9" });
    });

    it("cancelled at the supplier: recorded as failed (refund) and NOT booked again", async () => {
        lookupReturns({ result: "found", providerStatus: "cancelled", providerBookingId: "ord_9" });

        const action = await recoverBooking(makeBooking(), NOW);

        expect(action).toBe("failed_from_lookup");
        expect(confirmWithProvider).not.toHaveBeenCalled();
        expect(bookingFindOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
            status: "failed",
            fulfillmentStatus: "failed",
            fulfillmentReason: "supplier_cancelled",
        });
    });

    it("still pending at the supplier: kept as unknown and NOT booked again", async () => {
        lookupReturns({ result: "found", providerStatus: "pending", providerBookingId: "ord_9" });

        const action = await recoverBooking(makeBooking(), NOW);

        expect(action).toBe("still_pending_at_supplier");
        expect(confirmWithProvider).not.toHaveBeenCalled();
        expect(bookingUpdateOne.mock.calls[0][1].$set).toMatchObject({ fulfillmentStatus: "unknown", fulfillmentReason: "supplier_pending", fulfillmentCheckedAt: NOW });
    });

    it("lost the race to record it: skipped", async () => {
        lookupReturns({ result: "found", providerStatus: "confirmed", providerBookingId: "ord_9" });
        bookingFindOneAndUpdate.mockResolvedValue(null);

        expect(await recoverBooking(makeBooking(), NOW)).toBe("skipped");
    });
});

describe("recoverBooking: the supplier definitively has nothing", () => {
    it("re-sends exactly once, under a lease tied to the current state and attempt count", async () => {
        lookupReturns({ result: "not_found" });
        confirmWithProvider.mockResolvedValue({ outcome: "confirmed", providerBookingId: "ord_2" });

        const action = await recoverBooking(makeBooking({ fulfillmentStatus: "unknown", fulfillmentAttempts: 1 }), NOW);

        expect(action).toBe("resent");
        expect(confirmWithProvider).toHaveBeenCalledTimes(1);
        const [leaseFilter, leaseUpdate] = bookingFindOneAndUpdate.mock.calls[0];
        expect(leaseFilter).toMatchObject({ paymentStatus: "paid", fulfillmentStatus: "unknown", fulfillmentAttempts: 1 });
        expect(leaseUpdate.$set).toMatchObject({ fulfillmentStatus: "in_progress", fulfillmentStartedAt: NOW });
        expect(leaseUpdate.$inc).toEqual({ fulfillmentAttempts: 1 });
        expect(bookingFindOneAndUpdate.mock.calls[1][1].$set).toMatchObject({ status: "confirmed", providerBookingId: "ord_2" });
    });

    it("a re-send that is rejected is recorded as failed, one that is unclear goes back to unknown", async () => {
        lookupReturns({ result: "not_found" });
        confirmWithProvider.mockResolvedValueOnce({ outcome: "failed", reason: "sold out" });

        await recoverBooking(makeBooking(), NOW);
        expect(bookingFindOneAndUpdate.mock.calls[1][1].$set).toMatchObject({ fulfillmentStatus: "failed", fulfillmentReason: "sold out" });

        bookingFindOneAndUpdate.mockClear();
        confirmWithProvider.mockResolvedValueOnce({ outcome: "unknown", reason: "timeout" });

        await recoverBooking(makeBooking(), NOW);
        expect(bookingFindOneAndUpdate.mock.calls[1][1].$set).toMatchObject({ fulfillmentStatus: "unknown", fulfillmentReason: "timeout" });
    });

    it("another worker leased it first: skipped, supplier not called", async () => {
        lookupReturns({ result: "not_found" });
        bookingFindOneAndUpdate.mockResolvedValue(null);

        expect(await recoverBooking(makeBooking(), NOW)).toBe("skipped");
        expect(confirmWithProvider).not.toHaveBeenCalled();
    });

    it("stops re-sending after the maximum number of attempts and leaves it for a person", async () => {
        lookupReturns({ result: "not_found" });

        const action = await recoverBooking(makeBooking({ fulfillmentAttempts: MAX_RESEND_ATTEMPTS }), NOW);

        expect(action).toBe("left_for_review");
        expect(confirmWithProvider).not.toHaveBeenCalled();
        expect(bookingFindOneAndUpdate).not.toHaveBeenCalled();
        expect(bookingUpdateOne.mock.calls[0][1].$set).toMatchObject({ fulfillmentStatus: "unknown", fulfillmentReason: "max_resend_attempts_reached" });
    });
});

describe("recoverBooking: the supplier cannot be asked, so it is never re-sent", () => {
    it.each([
        ["lookup not implemented", { result: "unsupported", reason: "duffel_lookup_not_implemented" }, "duffel_lookup_not_implemented"],
        ["lookup failed", { result: "error", reason: "timeout" }, "timeout"],
    ])("%s", async (_name, result, reason) => {
        lookupReturns(result);

        const action = await recoverBooking(makeBooking({ fulfillmentStatus: "in_progress" }), NOW);

        expect(action).toBe("left_for_review");
        expect(confirmWithProvider).not.toHaveBeenCalled();
        expect(bookingFindOneAndUpdate).not.toHaveBeenCalled();
        expect(bookingUpdateOne.mock.calls[0][1].$set).toMatchObject({ status: "pending", fulfillmentStatus: "unknown", fulfillmentReason: reason, fulfillmentCheckedAt: NOW });
    });

    it("a lookup that throws is treated like a failed lookup", async () => {
        setProviderLookup({ find: jest.fn(async () => { throw new Error("network"); }) } as any);

        const action = await recoverBooking(makeBooking(), NOW);

        expect(action).toBe("left_for_review");
        expect(confirmWithProvider).not.toHaveBeenCalled();
        expect(bookingUpdateOne.mock.calls[0][1].$set.fulfillmentReason).toContain("lookup_threw");
    });
});

describe("recoverStuckBookings", () => {
    const stub = (docs: any[]) => {
        const limit = jest.fn<(...args: any[]) => Promise<any[]>>(async () => docs);
        const sort = jest.fn<(...args: any[]) => { limit: typeof limit }>(() => ({ limit }));
        bookingFind.mockReturnValue({ sort });
        return { sort, limit };
    };

    it("only selects paid bookings that are stale in_progress or due-for-recheck unknown", async () => {
        const { limit } = stub([]);

        const summary = await recoverStuckBookings(NOW);

        const query = bookingFind.mock.calls[0][0];
        expect(query.paymentStatus).toBe("paid");
        expect(query.$or).toEqual([
            { fulfillmentStatus: "in_progress", fulfillmentStartedAt: { $lt: new Date(NOW.getTime() - IN_PROGRESS_STALE_MS) } },
            {
                fulfillmentStatus: "unknown",
                $or: [{ fulfillmentCheckedAt: null }, { fulfillmentCheckedAt: { $lt: new Date(NOW.getTime() - UNKNOWN_RECHECK_MS) } }],
            },
        ]);
        expect(limit).toHaveBeenCalledWith(RECOVERY_BATCH_SIZE);
        expect(summary.checked).toBe(0);
    });

    it("counts each action and survives one booking blowing up", async () => {
        stub([makeBooking({ _id: "a" }), makeBooking({ _id: "b" }), makeBooking({ _id: "c" })]);
        let calls = 0;
        setProviderLookup({
            find: jest.fn(async () => {
                calls += 1;
                if (calls === 1) return { result: "found", providerStatus: "confirmed", providerBookingId: "ord_1" };
                if (calls === 2) return { result: "unsupported", reason: "x" };
                throw new Error("unreachable");
            }),
        } as any);
        bookingUpdateOne.mockImplementation(async () => {
            if (calls === 3) throw new Error("db");
            return { acknowledged: true };
        });
        bookingFindOneAndUpdate.mockResolvedValue({ ...makeBooking(), fulfillmentStatus: "confirmed" });

        const summary = await recoverStuckBookings(NOW);

        expect(summary.checked).toBe(3);
        expect(summary.counts.confirmed_from_lookup).toBe(1);
        expect(summary.counts.left_for_review).toBe(1);
        expect(summary.counts.error).toBe(1);
        expect(confirmWithProvider).not.toHaveBeenCalled();
    });
});