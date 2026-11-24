import { SETTLEMENT_CURRENCY, hasPriceChanged } from "./hotelBooking.js";
import { isSamePrice } from "./flightPricing.js";

type PricedBooking = {
    bookingType?: string;
    totalPrice: number;
    flightData?: { price?: { currency?: string } } | null;
};

type QuotedAttempt = {
    quotedTotal?: number | null;
    quotedCurrency?: string | null;
};

// The currency booking.totalPrice is stored in: Duffel's currency for flights,
// naira for hotels (LiteAPI prebook is always read in SETTLEMENT_CURRENCY).
export const supplierCurrency = (booking: PricedBooking): string => {
    if (booking.bookingType === "flight") {
        return (booking.flightData?.price?.currency ?? SETTLEMENT_CURRENCY).toUpperCase();
    }
    return SETTLEMENT_CURRENCY;
};

// Do two totals count as the same price? Flights: exact. Hotels keep their
// existing 0.5% / 1 naira rounding tolerance.
export const totalsMatch = (booking: PricedBooking, a: number, b: number): boolean =>
    booking.bookingType === "flight" ? isSamePrice(a, b) : !hasPriceChanged(a, b);

export const attemptQuoteStillMatches = (booking: PricedBooking, attempt: QuotedAttempt): boolean => {
    if (attempt.quotedTotal === undefined || attempt.quotedTotal === null) return true;

    if (attempt.quotedCurrency && attempt.quotedCurrency.toUpperCase() !== supplierCurrency(booking)) {
        return false;
    }

    return totalsMatch(booking, attempt.quotedTotal, booking.totalPrice);
};