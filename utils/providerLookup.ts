import type { BookingDocument } from "../Model/booking.js";
import { listBookingsByClientReference, LiteApiError } from "../Config/liteBooking.js";

export type ProviderLookupResult = 
    | {
          result: "found";
          providerStatus: "confirmed" | "pending" | "cancelled";
          providerBookingId: string;
          providerData?: Record<string, any>;
    }
    | { result: "not_found" }
    | { result: "unsupported"; reason: string }
    | { result: "error"; reason: string };

    export interface ProviderLookup {
        find(booking: BookingDocument): Promise< ProviderLookupResult>;
    }

// TODO(duffel-payload): implement together with the Duffel payload fix. Put
// booking.bookingReference in the order `metadata` when creating the order, then look the order
// up by it (list recent orders for the passenger and match metadata.bookingReference, or keep the
// order id from the order.created webhook). Return "not_found" ONLY when that search is complete.

const findFlightOrder = async (_booking: BookingDocument): Promise<ProviderLookupResult> => ({
    result: "unsupported",
    reason: "duffel_lookup_not_implemented",
});


export const findHotelBooking = async (booking: BookingDocument): Promise<ProviderLookupResult> => {
    let data: any;
    try {
        data = await listBookingsByClientReference(booking.bookingReference);
    } catch (error: any) {
        const reason = error instanceof LiteApiError ? error.message : `lookup_failed: ${error?.message ?? error}`;
        return { result: "error", reason: reason.slice(0, 200) };
    }

    if (!Array.isArray(data)) {
        return { result: "error", reason: "unexpected_lookup_response" };
    }
    if (data.length === 0) {
        return { result: "not_found"};
    }

    const matches = data.filter((entry: any) => entry?.clientReference === booking.bookingReference);
    if (matches.length === 0) {
        return { result: "error", reason: "lookup_returned_unrelated_bookings" };
    }
    if (matches.length > 1) {
        console.error(`LiteAPI returned ${matches.length} bookings for reference ${booking.bookingReference}`);
    }
    
    const statusOf = (entry: any): "confirmed" | "pending" | "cancelled" => {
        const status = String(entry?.status ?? "").toUpperCase();
        if (status === "CONFIRMED") return "confirmed";
        if (status.startsWith("CANCEL")) return "cancelled";
        return "pending";
    };

    // If there is ever more than one, a confirmed one wins.
    const entry = matches.find((m: any) => statusOf(m) === "confirmed") ?? matches[0];
    const providerBookingId = entry?.bookingId != null ? String(entry.bookingId) : "";
    if (!providerBookingId) {
        return { result: "error", reason: "lookup_booking_without_id" };
    }
    
    return {
        result: "found",
        providerStatus: statusOf(entry),
        providerBookingId,
        providerData: {
            status: entry.status ?? null,
            hotelConfirmationCode: entry.hotelConfirmationCode ?? null,
            supplierBookingId: entry.supplierBookingId ?? null,
            recoveredVia: "lookup",
        },
    };
};

let activeLookup: ProviderLookup = {
    async find(booking) {
        return booking.bookingType === "flight" ? findFlightOrder(booking) : findHotelBooking(booking);
    },
};

export const providerLookup: ProviderLookup = {
    find: (booking) => activeLookup.find(booking),
};

// For tests, and for swapping in the real implementations later.
export const setProviderLookup = (lookup: ProviderLookup): void => {
    activeLookup = lookup;
};