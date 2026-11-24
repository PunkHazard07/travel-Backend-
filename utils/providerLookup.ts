import type { BookingDocument } from "../Model/booking.js";

// "Does a reservation for this booking already exist at the supplier?"

//  found        : a reservation exists (confirmed, still pending, or cancelled at the supplier)
//  not_found    : the supplier definitively has nothing for this booking: re-sending is safe
//  unsupported  : no lookup is implemented for this supplier yet: NEVER re-send, a person decides
//  error        : the lookup itself failed: NEVER re-send, try again later
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

// TODO(liteapi): confirm in LiteAPI's docs how to list/retrieve a booking by clientReference
// (booking.bookingReference is sent as the clientReference) and whether a prebookId can be
// re-sent after a timeout. Return "not_found" ONLY when LiteAPI says no booking has that reference
const findHotelBooking = async (_booking: BookingDocument): Promise<ProviderLookupResult> => ({
    result: "unsupported",
    reason: "liteapi_lookup_not_implemented",
});

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