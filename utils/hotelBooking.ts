import { computeNights } from "./hotelPricing.js";
import type { BookRequestBody } from "../Config/liteBooking.js";

export const SETTLEMENT_CURRENCY = "NGN";
export const MAX_STAY_NIGHTS = 30;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export const isValidDateOnly = (value: unknown): value is string => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const todayUtc = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export interface Holder {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
}

export interface GuestInput {
    occupancyNumber: number;
    firstName: string;
    lastName: string;
    email?: string;
}

export interface HotelBookingInput {
    offerId: string;
    hotelId: string;
    hotelName?: string;
    checkin: string;
    checkout: string;
    nights: number;
    holder: Holder;
    guests: GuestInput[];
    expectedTotal?: number;
}

type Validation = { ok: true; value: HotelBookingInput } | { ok: false; message: string };

const isNonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateHotelBookingInput = (body: any, today: string = todayUtc()): Validation => {
    if (!body || typeof body !== "object") return { ok: false, message: "Request body is required" };

    const { offerId, hotelId, hotelName, checkin, checkout, holder, guests, expectedTotal } = body;

    if (!isNonEmptyString(offerId)) return { ok: false, message: "offerId is required" };
    if (!isNonEmptyString(hotelId)) return { ok: false, message: "hotelId is required" };

    if (!isValidDateOnly(checkin) || !isValidDateOnly(checkout)) {
        return { ok: false, message: "checkin and checkout must be dates in YYYY-MM-DD format" };
    }
    // Compared as date strings (not instants) so a same-day check-in isn't
    // rejected just because it parses as midnight UTC.
    if (checkin < today) return { ok: false, message: "Check-in date cannot be in the past" };
    if (checkout <= checkin) return { ok: false, message: "Check-out date must be after check-in date" };

    const nights = computeNights(checkin, checkout);
    if (nights > MAX_STAY_NIGHTS) return { ok: false, message: `Stays are limited to ${MAX_STAY_NIGHTS} nights` };

    if (!holder || !isNonEmptyString(holder.firstName) || !isNonEmptyString(holder.lastName)) {
        return { ok: false, message: "holder.firstName and holder.lastName are required" };
    }
    if (!isNonEmptyString(holder.email) || !EMAIL_RE.test(holder.email.trim())) {
        return { ok: false, message: "A valid holder.email is required" };
    }

    const cleanHolder: Holder = {
        firstName: holder.firstName.trim(),
        lastName: holder.lastName.trim(),
        email: holder.email.trim(),
        ...(isNonEmptyString(holder.phone) ? { phone: holder.phone.trim() } : {}),
    };

    let cleanGuests: GuestInput[];
    if (guests === undefined || guests === null) {
        cleanGuests = [{ occupancyNumber: 1, firstName: cleanHolder.firstName, lastName: cleanHolder.lastName, email: cleanHolder.email }];
    } else {
        if (!Array.isArray(guests) || guests.length === 0 || guests.length > 10) {
            return { ok: false, message: "guests must be a list of 1 to 10 people" };
        }
        cleanGuests = [];
        for (const g of guests) {
            if (!g || !isNonEmptyString(g.firstName) || !isNonEmptyString(g.lastName)) {
                return { ok: false, message: "Every guest needs a firstName and lastName" };
            }
            // Search is always a single room (one occupancy), so every guest
            // belongs to occupancy 1.
            cleanGuests.push({
                occupancyNumber: 1,
                firstName: g.firstName.trim(),
                lastName: g.lastName.trim(),
                ...(isNonEmptyString(g.email) && EMAIL_RE.test(g.email.trim()) ? { email: g.email.trim() } : {}),
            });
        }
    }

    let cleanExpected: number | undefined;
    if (expectedTotal !== undefined && expectedTotal !== null) {
        const n = Number(expectedTotal);
        if (!Number.isFinite(n) || n <= 0) return { ok: false, message: "expectedTotal must be a positive number" };
        cleanExpected = n;
    }

    return {
        ok: true,
        value: {
            offerId: offerId.trim(),
            hotelId: hotelId.trim(),
            ...(isNonEmptyString(hotelName) ? { hotelName: hotelName.trim() } : {}),
            checkin,
            checkout,
            nights,
            holder: cleanHolder,
            guests: cleanGuests,
            ...(cleanExpected !== undefined ? { expectedTotal: cleanExpected } : {}),
        },
    };
};

export class PrebookPriceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PrebookPriceError";
    }
}

export interface PrebookPrice {
    total: number;
    currency: string;
    basis: "retailRate" | "price";
    reportedPrice: number | null;
}

export const computePrebookPrice = (data: any, currency: string = SETTLEMENT_CURRENCY): PrebookPrice => {
    const reportedPrice = typeof data?.price === "number" && Number.isFinite(data.price) ? data.price : null;

    const rate = data?.roomTypes?.[0]?.rates?.[0];
    const totals: { amount: number; currency: string }[] | undefined = rate?.retailRate?.total;

    if (Array.isArray(totals) && totals.length > 0) {
        const entry = totals.find((m) => m?.currency === currency);
        if (!entry || typeof entry.amount !== "number") {
            throw new PrebookPriceError(`Prebook response has no ${currency} total`);
        }
        const excludedTax = ((rate.retailRate.taxesAndFees ?? []) as any[])
            .filter((t) => t?.included === false)
            .filter((t) => !t.currency || t.currency === currency)
            .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

        return { total: round2(entry.amount + excludedTax), currency, basis: "retailRate", reportedPrice };
    }

    if (reportedPrice !== null && data?.currency === currency) {
        return { total: round2(reportedPrice), currency, basis: "price", reportedPrice };
    }

    throw new PrebookPriceError("Prebook response has no usable price");
};

// True when the authoritative price differs from what the customer saw by
// more than a rounding-sized amount (0.5% or ₦1, whichever is larger).
export const hasPriceChanged = (expected: number, actual: number): boolean => {
    const tolerance = Math.max(1, Math.abs(expected) * 0.005);
    return Math.abs(actual - expected) > tolerance;
};

export const buildBookRequest = (params: {
    prebookId: string;
    holder: Holder;
    guests: GuestInput[];
    clientReference: string;
    paymentMethod: string;
}): BookRequestBody => ({
    prebookId: params.prebookId,
    holder: params.holder,
    guests: params.guests.map((g, i) => ({
        occupancyNumber: g.occupancyNumber || 1,
        firstName: g.firstName,
        lastName: g.lastName,
        ...(g.email ? { email: g.email } : {}),
    })),
    payment: { method: params.paymentMethod },
    // Idempotency key: re-sending the same booking can never double-book.
    clientReference: params.clientReference,
});

export interface BookOutcome {
    confirmed: boolean;
    providerBookingId: string | null;
    status: string | null;
    confirmationCode: string | null;
    supplierBookingId: string | null;
}

export const mapBookResponse = (data: any): BookOutcome => {
    const status = typeof data?.status === "string" ? data.status : null;
    const bookingId = data?.bookingId != null ? String(data.bookingId) : null;
    return {
        confirmed: status?.toUpperCase() === "CONFIRMED" && bookingId !== null,
        providerBookingId: bookingId,
        status,
        confirmationCode: data?.hotelConfirmationCode != null ? String(data.hotelConfirmationCode) : null,
        supplierBookingId: data?.supplierBookingId != null ? String(data.supplierBookingId) : null,
    };
};