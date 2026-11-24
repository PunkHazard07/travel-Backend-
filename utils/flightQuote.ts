import { collectServicePrices, computeFlightTotal, type FlightTotal, type SelectedServiceInput } from "./flightPricing.js";

export type FlightQuoteErrorCode =
    | "provider_not_configured"
    | "offer_unavailable"
    | "offer_expired"
    | "provider_unavailable";

export class FlightQuoteError extends Error {
    readonly code: FlightQuoteErrorCode;

    constructor(code: FlightQuoteErrorCode, message: string) {
        super(message);
        this.name = "FlightQuoteError";
        this.code = code;
    }
}

export interface FlightOfferSource {
    isConfigured(): boolean;
    getOffer(offerId: string): Promise<any>;
    getSeatMap(offerId: string): Promise<any>;
}

export interface FlightQuote {
    offer: any;
    total: FlightTotal;
}

// Asks Duffel what this offer costs RIGHT NOW. Used both when the booking is
// created and again just before payment, so the two can never disagree on how a
// price is worked out.
//
// Throws FlightQuoteError when Duffel says the offer is gone / expired / can't be
// reached, and FlightPriceError (from flightPricing) when the price or a selected
// extra can't be worked out. It never returns a guessed price.
export const fetchFlightQuote = async (
    duffel: FlightOfferSource,
    offerId: string,
    selected: SelectedServiceInput[],
    now: number = Date.now()
): Promise<FlightQuote> => {
    if (!duffel.isConfigured()) {
        throw new FlightQuoteError("provider_not_configured", "Flight booking is temporarily unavailable");
    }

    const offerResult = await duffel.getOffer(offerId);
    if (!offerResult.success) {
        const status = offerResult.error?.status;
        if (status === 404 || status === 410 || status === 422) {
            throw new FlightQuoteError("offer_unavailable", "This flight offer is no longer available. Please search again.");
        }
        console.error("Duffel getOffer failed:", offerResult.error);
        throw new FlightQuoteError("provider_unavailable", "The flight provider is temporarily unavailable");
    }

    const offer = offerResult.data;

    if (offer.expires_at && new Date(offer.expires_at).getTime() <= now) {
        throw new FlightQuoteError("offer_expired", "This flight offer has expired. Please search again.");
    }

    // Bag-type extras are on the offer; seats are only in the seat map.
    let prices = collectServicePrices(offer);
    if (selected.some((s) => typeof s.id === "string" && !prices.has(s.id))) {
        const seatResult = await duffel.getSeatMap(offerId);
        if (seatResult.success) {
            prices = collectServicePrices(offer, seatResult.data);
        } else if (seatResult.error?.code !== "seat_map_unavailable") {
            console.error("Duffel seat map failed:", seatResult.error);
            throw new FlightQuoteError("provider_unavailable", "The flight provider is temporarily unavailable");
        }
    }

    return { offer, total: computeFlightTotal(offer, selected, prices) };
};