import { fetchHotelRates } from "../Config/hotel.js";
import { getCachedRates } from "./ratesCache.js";

export interface LowestRate {
    total: number; // tax-inclusive total for the full stay
    perNight: number | null;
    currency: string;
    nights: number;
}

interface Money {
    amount: number;
    currency: string;
}

interface TaxFee {
    included: boolean;
    amount: number;
    currency?: string;
    description?: string;
}

interface RetailRate {
    total: Money[];
    taxesAndFees?: TaxFee[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

// LiteAPI marks each tax/fee with `included`. Where `included: false`,
// that amount is NOT folded into `retailRate.total` — confirmed against
// real sandbox data (VAT entries consistently `included: false` while
// `total` stayed unchanged). Skipping this means undercharging the guest
// by the tax amount at checkout, silently.

export const computeCheckoutTotal = (retailRate: RetailRate, currency: string): number => {
const totalEntry =
    retailRate.total.find((m) => m.currency === currency) ?? retailRate.total[0];

    if (!totalEntry) return 0;

    const excludedTax = (retailRate.taxesAndFees ?? [])
        .filter((t) => t.included === false)
        .filter((t) => !t.currency || t.currency === currency)
        .reduce((sum, t) => sum + t.amount, 0);

    return round2(totalEntry.amount + excludedTax);
};

export const computeNights = (checkin: string, checkout: string): number => {
        const inDate = new Date(`${checkin}T00:00:00Z`);
        const outDate = new Date(`${checkout}T00:00:00Z`);
        const ms = outDate.getTime() - inDate.getTime();
    return Math.round(ms / (1000 * 60 * 60 * 24));
};

export const computePerNight = (checkoutTotal: number, nights: number): number | null => {
    if (!nights || nights <= 0) return null;
    return round2(checkoutTotal / nights);
}

// Default to a week out, 2-night stay — used only when the caller
// doesn't supply dates. LiteAPI's rates endpoint requires checkin/checkout.
export const defaultDateRange = (): { checkin: string; checkout: string } => {
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const checkin = new Date();
    checkin.setDate(checkin.getDate() + 7);
    const checkout = new Date(checkin);
    checkout.setDate(checkout.getDate() + 2);
    return { checkin: fmt(checkin), checkout: fmt(checkout) };
};

export const buildLowestPriceMap = (ratesResponse: any, nights: number, currency: string): Map<string, LowestRate> => {
    const map = new Map<string, LowestRate>();
    const hotels = ratesResponse?.data ?? [];

    for (const hotel of hotels) {
        const hotelId = hotel?.hotelId;
        if (!hotelId) continue;

    let lowestTotal: number | null = null;

        for (const roomType of hotel.roomTypes ?? []) {
            for (const rate of roomType?.rates ?? []) {
                if (!rate?.retailRate?.total) continue;
                const checkoutTotal = computeCheckoutTotal(rate.retailRate, currency);
            if (lowestTotal === null || checkoutTotal < lowestTotal) {
                lowestTotal = checkoutTotal;
            }
        }
    }
        if (lowestTotal !== null){
            map.set(hotelId, {
                total: lowestTotal,
                perNight: computePerNight(lowestTotal, nights),
                currency,
                nights
            });
        }
    }

    return map;
};

export const fetchLowestPricesSafely = async (params: Parameters<typeof fetchHotelRates>[0]): Promise<Map<string, LowestRate>> => {
    const cacheKey = [
        params.countryCode,
        params.cityName.toLowerCase(),
        params.checkin,
        params.checkout,
        params.adults ?? 2,
        params.guestNationality ?? "US",
    ].join("|");

    const nights = computeNights(params.checkin, params.checkout);
    const currency = params.currency ?? "NGN";

    try {
        const ratesResponse = await getCachedRates(cacheKey, () => fetchHotelRates(params));
        return buildLowestPriceMap(ratesResponse, nights, currency);
    } catch (error: any) {
        console.warn("Hotel rates fetch failed, continuing without live prices:", error.message);
        return new Map();
    }
};

export const attachPrice = (priceMap: Map<string, LowestRate>) => (hotel: any) => {
    const rate = priceMap.get(hotel.apiHotelId);
    return {
        ...hotel,
        fromPriceTotal: rate?.total ?? null,
        fromPricePerNight: rate?.perNight ?? null,
        fromPriceCurrency: rate?.currency ?? null,
        nights: rate?.nights ?? null,
    };
};

export const byRatingThenPrice = (a: any, b: any): number => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const aPrice = a.fromPricePerNight ?? Infinity;
    const bPrice = b.fromPricePerNight ?? Infinity;
    return aPrice - bPrice;
};

// TODO(4b-rating): rating (guest score) is NOT bucketed here. Unlike
// `stars`, rating is a continuous value with no fixed tier set, so grouping
// it needs a banding decision that hasn't been made yet (e.g. cumulative
// "9+/8+/7+" bands, the way Booking.com does it, where a hotel can qualify
// for more than one band) rather than exclusive tiers like stars use. Don't
// extend this function for it later — the aggregation shape is different.

export interface StarTier {
    stars: number;
    fromPricePerNight: number | null;
    currency: string | null;
    hotelCount: number;
}

interface TierAccumulator {
    minPrice: number | null;
    currency: string | null;
    count: number;
}

export const buildPriceByStarTier = (hotels: any[]): StarTier[] => {
    const tiers = new Map<number, TierAccumulator>();

    for (const hotel of hotels) {
        const stars = typeof hotel.stars === "number" ? hotel.stars : 0;
        if (stars <= 0) continue;

        const tier = tiers.get(stars) ?? { minPrice: null, currency: null, count: 0 };
        tier.count += 1;

        const price = hotel.fromPricePerNight;
        if (price != null && (tier.minPrice === null || price < tier.minPrice)) {
            tier.minPrice = price;
            tier.currency = hotel.fromPriceCurrency ?? null;
        }

        tiers.set(stars, tier);
    }

        return Array.from(tiers.entries())
        .map(([stars, tier]) => ({
            stars,
            fromPricePerNight: tier.minPrice,
            currency: tier.currency,
            hotelCount: tier.count,
        }))
        .sort((a, b) => a.stars - b.stars);
};