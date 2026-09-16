import { fetchHotelRates } from "../Config/hotel.js";
import { getCachedRates } from "./ratesCache.js";

export interface LowestRate {
    amount: number;
    currency: string;
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

const buildLowestPriceMap = (ratesResponse: any): Map<string, LowestRate> => {
    const map = new Map<string, LowestRate>();
    const hotels = ratesResponse?.data ?? [];

    for (const hotel of hotels) {
        const hotelId = hotel?.hotelId;
        if (!hotelId) continue;

    let lowest: LowestRate | null = null;
        for (const roomType of hotel.roomTypes ?? []) {
            const rate = roomType?.offerRetailRate;
            if (rate && typeof rate.amount === "number") {
                if (!lowest || rate.amount < lowest.amount) {
                lowest = { amount: rate.amount, currency: rate.currency };
            } 
        }
    }
        if (lowest) map.set(hotelId, lowest);
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

    try {
        const ratesResponse = await getCachedRates(cacheKey, () => fetchHotelRates(params));
        return buildLowestPriceMap(ratesResponse);
    } catch (error: any) {
        console.warn("Hotel rates fetch failed, continuing without live prices:", error.message);
        return new Map();
    }
};

export const attachPrice = (priceMap: Map<string, LowestRate>) => (hotel: any) => {
    const rate = priceMap.get(hotel.apiHotelId);
    return {
        ...hotel,
        fromPrice: rate?.amount ?? null,
        fromPriceCurrency: rate?.currency ?? null,
    };
};

export const byRatingThenPrice = (a: any, b: any): number => {
    if (b.rating !== a.rating) return b.rating - a.rating;
    const aPrice = a.fromPrice ?? Infinity;
    const bPrice = b.fromPrice ?? Infinity;
    return aPrice - bPrice;
};