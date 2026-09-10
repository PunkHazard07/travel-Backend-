import type { Request, Response } from "express";
import { fetchHotelsFromAPI, fetchHotelRates } from "../Config/hotel.js";
import { getCachedRates } from "../utils/ratesCache.js";
import { getCountryCode } from "../utils/countryCodeMapper.js";
import { attachNgnPrices } from "../utils/currencyConverter.js";
import { escapeRegExp } from "../utils/escapeRegExp.js";
import Hotel from "../Model/hotel.js";

interface LowestRate {
  amount: number;
  currency: string;
}

// Default to a week out, 2-night stay — used only when the caller
// doesn't supply dates. LiteAPI's rates endpoint requires checkin/checkout.
const defaultDateRange = (): { checkin: string; checkout: string } => {
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

const fetchLowestPricesSafely = async (
  params: Parameters<typeof fetchHotelRates>[0]
): Promise<Map<string, LowestRate>> => {
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

const attachPrice = (priceMap: Map<string, LowestRate>) => (hotel: any) => {
  const rate = priceMap.get(hotel.apiHotelId);
  return {
    ...hotel,
    fromPrice: rate?.amount ?? null,
    fromPriceCurrency: rate?.currency ?? null,
  };
};

const byRatingThenPrice = (a: any, b: any): number => {
  if (b.rating !== a.rating) return b.rating - a.rating;
  const aPrice = a.fromPrice ?? Infinity;
  const bPrice = b.fromPrice ?? Infinity;
  return aPrice - bPrice;
};

export const getHotels = async (req: Request, res: Response) => {
  try {
    const {
      country,
      cityName,
      limit = "60",
      checkin,
      checkout,
      adults = "2",
      guestNationality = "US",
    } = req.query as Record<string, string | undefined>;

    if (!country || !cityName) {
      return res.status(400).json({
        success: false,
        message: "Country and City Name are required",
      });
    }

    const countryCode = getCountryCode(country);

    if (!countryCode) {
      return res.status(400).json({
        success: false,
        message: "Invalid country name or code. Please provide a valid country.",
      });
    }

    const dates = checkin && checkout ? { checkin, checkout } : defaultDateRange();

    const priceMap = await fetchLowestPricesSafely({
      countryCode,
      cityName,
      checkin: dates.checkin,
      checkout: dates.checkout,
      guestNationality,
      adults: Number(adults),
    });
    const withPrice = attachPrice(priceMap);

    const cachedHotels = await Hotel.find({
      "location.country": countryCode,
      "location.city": { $regex: new RegExp(escapeRegExp(cityName), "i") },
      cachedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }, // 6 hours
    })
      .sort({ rating: -1 })
      .limit(parseInt(limit))
      .lean();

    if (cachedHotels.length > 0) {
      const priced = cachedHotels.map(withPrice).sort(byRatingThenPrice);
      return res.status(200).json({
        success: true,
        source: "cache",
        count: priced.length,
        data: attachNgnPrices(priced),
      });
    }

    // fetch metadata from API
    const apiResponse = await fetchHotelsFromAPI(countryCode, cityName, 100);

    if (!apiResponse || !apiResponse.data || !Array.isArray(apiResponse.data)) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch hotels from API",
        error: apiResponse || "No response from API",
      });
    }

    // save to the database - metadata only, no price field
    const savedHotels = await Promise.all(
      apiResponse.data.map(async (hotel: any) => {

    const stars = typeof hotel.stars === "number" ? hotel.stars : 0;
    const hotelData = {
          apiHotelId: hotel.id,
          name: hotel.name,
          location: {
            city: hotel.city || cityName,
            country: hotel.country || countryCode,
          },
          rating: typeof hotel.rating === "number" ? hotel.rating : 0,
          stars,
          main_photo: hotel.main_photo || "",
          thumbnail: hotel.thumbnail || "",
          hotelDescription: hotel.hotelDescription || "",
          cachedAt: new Date(),
        };

        return await Hotel.findOneAndUpdate({ apiHotelId: hotel.id }, hotelData, {
          upsert: true,
          new: true,
        });
      })
    );

    console.log(`Successfully saved ${savedHotels.length} hotels to database`);

    const limitedResults = savedHotels
      .map((doc: any) => withPrice(doc.toObject ? doc.toObject() : doc))
      .sort(byRatingThenPrice)
      .slice(0, parseInt(limit));

    res.status(200).json({
      success: true,
      source: "api",
      count: limitedResults.length,
      totalAvailable: savedHotels.length,
      data: attachNgnPrices(limitedResults),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const advancedHotelSearch = async (req: Request, res: Response) => {
  try {
    const {
      city,
      country,
      minRating = "0",
      maxPrice,
      sortBy = "recommended",
      limit = "60",
      page = "1",
      checkin,
      checkout,
      adults = "2",
      guestNationality = "US",
    } = req.query as Record<string, string | undefined>;

    // Build query for MongoDB — metadata filters only, price can't be
    // filtered at the DB layer anymore since it isn't stored.
    const query: Record<string, any> = {};

    if (city) {
      query["location.city"] = new RegExp(escapeRegExp(city), "i");
    }

    let countryCode: string | null = null;
    if (country) {
      countryCode = getCountryCode(country);
      if (countryCode) {
        query["location.country"] = countryCode;
      }
    }

    if (minRating && parseFloat(minRating) > 0) {
      query.rating = { $gte: parseFloat(minRating) };
    }

    const CANDIDATE_POOL_SIZE = 500;
    const candidates = await Hotel.find(query)
      .sort({ rating: -1 })
      .limit(CANDIDATE_POOL_SIZE)
      .lean();

    const dates = checkin && checkout ? { checkin, checkout } : defaultDateRange();

    let priced = candidates;
    if (city && countryCode) {
      const priceMap = await fetchLowestPricesSafely({
        countryCode,
        cityName: city,
        checkin: dates.checkin,
        checkout: dates.checkout,
        guestNationality,
        adults: Number(adults),
      });
      priced = candidates.map(attachPrice(priceMap));
    } else {
      priced = candidates.map((h: any) => ({ ...h, fromPrice: null, fromPriceCurrency: null }));
    }

    if (maxPrice && !isNaN(parseFloat(maxPrice))) {
      const maxUSD = parseFloat(maxPrice);
      // Hotels with no live price can't be confirmed under budget, so
      // they're excluded rather than assumed to qualify.
      priced = priced.filter((h: any) => h.fromPrice != null && h.fromPrice <= maxUSD);
    }

    const sorters: Record<string, (a: any, b: any) => number> = {
      "price-low": (a, b) => (a.fromPrice ?? Infinity) - (b.fromPrice ?? Infinity),
      "price-high": (a, b) => (b.fromPrice ?? -Infinity) - (a.fromPrice ?? -Infinity),
      rating: byRatingThenPrice,
    };
    priced.sort(sorters[sortBy] ?? byRatingThenPrice);

    const limitNum = parseInt(limit);
    const pageNum = parseInt(page);
    const skip = (pageNum - 1) * limitNum;
    const pageResults = priced.slice(skip, skip + limitNum);
    const totalCount = priced.length;

    res.status(200).json({
      success: true,
      count: pageResults.length,
      totalCount,
      page: pageNum,
      totalPages: Math.ceil(totalCount / limitNum),
      filters: { city, country, minRating, maxPrice, sortBy },
      data: attachNgnPrices(pageResults),
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};