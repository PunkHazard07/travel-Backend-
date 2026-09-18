import {
  computeCheckoutTotal,
  computeNights,
  computePerNight,
  buildLowestPriceMap,
  byRatingThenPrice,
  buildPriceByStarTier,
} from "../utils/hotelPricing.js";

describe("computeCheckoutTotal", () => {
  it("adds a tax/fee entry marked included: false", () => {
    // Real numbers from a verified sandbox response (London, NGN).
    const retailRate = {
      total: [{ amount: 719728.24, currency: "NGN" }],
      taxesAndFees: [{ included: false, amount: 135797.78, currency: "NGN" }],
    };
    expect(computeCheckoutTotal(retailRate, "NGN")).toBe(855526.02);
  });

  it("does NOT add a tax/fee entry marked included: true", () => {
    const retailRate = {
      total: [{ amount: 1000, currency: "USD" }],
      taxesAndFees: [{ included: true, amount: 200, currency: "USD" }],
    };
    expect(computeCheckoutTotal(retailRate, "USD")).toBe(1000);
  });

  it("returns the bare total when there are no taxesAndFees at all", () => {
    const retailRate = { total: [{ amount: 500, currency: "USD" }] };
    expect(computeCheckoutTotal(retailRate, "USD")).toBe(500);
  });

  it("sums multiple excluded taxes and ignores included ones in the same array", () => {
    const retailRate = {
      total: [{ amount: 1000, currency: "USD" }],
      taxesAndFees: [
        { included: false, amount: 50, currency: "USD" },
        { included: false, amount: 25, currency: "USD" },
        { included: true, amount: 999, currency: "USD" },
      ],
    };
    expect(computeCheckoutTotal(retailRate, "USD")).toBe(1075);
  });

  it("falls back to the first total entry when no entry matches the requested currency", () => {
    const retailRate = { total: [{ amount: 300, currency: "EUR" }] };
    expect(computeCheckoutTotal(retailRate, "USD")).toBe(300);
  });

  it("returns 0 when total is an empty array", () => {
    const retailRate = { total: [] };
    expect(computeCheckoutTotal(retailRate, "USD")).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const retailRate = {
      total: [{ amount: 100.005, currency: "USD" }],
      taxesAndFees: [{ included: false, amount: 0.001, currency: "USD" }],
    };
    expect(computeCheckoutTotal(retailRate, "USD")).toBeCloseTo(100.01, 2);
  });
});

describe("computeNights", () => {
  it("computes a standard multi-night stay", () => {
    expect(computeNights("2026-10-10", "2026-10-12")).toBe(2);
  });

  it("computes a single-night stay", () => {
    expect(computeNights("2026-10-10", "2026-10-11")).toBe(1);
  });

  it("returns 0 for identical checkin/checkout dates", () => {
    expect(computeNights("2026-10-10", "2026-10-10")).toBe(0);
  });

  it("is not off-by-one across a month boundary", () => {
    expect(computeNights("2026-01-30", "2026-02-02")).toBe(3);
  });

  it("is not off-by-one across a year boundary", () => {
    expect(computeNights("2026-12-30", "2027-01-02")).toBe(3);
  });
});

describe("computePerNight", () => {
  it("divides total by nights and rounds to 2 decimals", () => {
    expect(computePerNight(855526.02, 2)).toBe(427763.01);
  });

  it("returns null for 0 nights instead of dividing by zero", () => {
    expect(computePerNight(1000, 0)).toBeNull();
  });

  it("returns null for negative nights", () => {
    expect(computePerNight(1000, -1)).toBeNull();
  });

  it("handles a 1-night stay (total === per-night)", () => {
    expect(computePerNight(500, 1)).toBe(500);
  });
});

describe("buildLowestPriceMap", () => {
  it("picks the cheapest room by TAX-INCLUSIVE total, not pre-tax total", () => {
    // Room A has a lower pre-tax total (900) but heavy tax, ending up
    // MORE expensive than Room B (1000 pre-tax, light tax) after tax.
    // This is the core regression case for the bug this batch fixes —
    // picking by pre-tax amount would wrongly choose Room A.
    const ratesResponse = {
      data: [
        {
          hotelId: "hotel1",
          roomTypes: [
            {
              rates: [
                {
                  retailRate: {
                    total: [{ amount: 900, currency: "USD" }],
                    taxesAndFees: [{ included: false, amount: 300, currency: "USD" }],
                  },
                },
              ],
            },
            {
              rates: [
                {
                  retailRate: {
                    total: [{ amount: 1000, currency: "USD" }],
                    taxesAndFees: [{ included: false, amount: 10, currency: "USD" }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const map = buildLowestPriceMap(ratesResponse, 2, "USD");
    const result = map.get("hotel1");

    // Room A tax-inclusive: 1200. Room B tax-inclusive: 1010. B wins.
    expect(result?.total).toBe(1010);
    expect(result?.perNight).toBe(505);
  });

  it("skips hotels with no hotelId", () => {
    const ratesResponse = {
      data: [{ roomTypes: [{ rates: [{ retailRate: { total: [{ amount: 100, currency: "USD" }] } }] }] }],
    };
    const map = buildLowestPriceMap(ratesResponse, 1, "USD");
    expect(map.size).toBe(0);
  });

  it("skips roomTypes with no rates and does not throw", () => {
    const ratesResponse = {
      data: [{ hotelId: "hotel1", roomTypes: [{ rates: [] }, { roomTypeId: "no-rates-key" }] }],
    };
    const map = buildLowestPriceMap(ratesResponse, 2, "USD");
    expect(map.has("hotel1")).toBe(false);
  });

  it("returns an empty map for an empty response", () => {
    expect(buildLowestPriceMap({ data: [] }, 2, "USD").size).toBe(0);
    expect(buildLowestPriceMap({}, 2, "USD").size).toBe(0);
    expect(buildLowestPriceMap(null, 2, "USD").size).toBe(0);
  });

  it("carries the correct currency and nights through to the result", () => {
    const ratesResponse = {
      data: [
        {
          hotelId: "hotel1",
          roomTypes: [
            { rates: [{ retailRate: { total: [{ amount: 600, currency: "NGN" }] } }] },
          ],
        },
      ],
    };
    const result = buildLowestPriceMap(ratesResponse, 3, "NGN").get("hotel1");
    expect(result?.currency).toBe("NGN");
    expect(result?.nights).toBe(3);
    expect(result?.perNight).toBe(200);
  });
});

describe("buildPriceByStarTier", () => {
  it("groups hotels by stars and finds the cheapest per-night price in each tier", () => {
    const hotels = [
      { stars: 5, fromPricePerNight: 90000, fromPriceCurrency: "NGN" },
      { stars: 5, fromPricePerNight: 60000, fromPriceCurrency: "NGN" },
      { stars: 3, fromPricePerNight: 20000, fromPriceCurrency: "NGN" },
    ];
    const result = buildPriceByStarTier(hotels);

    const fiveStar = result.find((t) => t.stars === 5);
    const threeStar = result.find((t) => t.stars === 3);
    expect(fiveStar).toMatchObject({ fromPricePerNight: 60000, currency: "NGN", hotelCount: 2 });
    expect(threeStar).toMatchObject({ fromPricePerNight: 20000, currency: "NGN", hotelCount: 1 });
  });

  it("sorts tiers ascending by stars", () => {
    const hotels = [
      { stars: 5, fromPricePerNight: 90000, fromPriceCurrency: "NGN" },
      { stars: 1, fromPricePerNight: 5000, fromPriceCurrency: "NGN" },
      { stars: 3, fromPricePerNight: 20000, fromPriceCurrency: "NGN" },
    ];
    const result = buildPriceByStarTier(hotels);
    expect(result.map((t) => t.stars)).toEqual([1, 3, 5]);
  });

  it("excludes stars: 0 (the unrated sentinel) from the result", () => {
    const hotels = [
      { stars: 0, fromPricePerNight: 15000, fromPriceCurrency: "NGN" },
      { stars: 4, fromPricePerNight: 40000, fromPriceCurrency: "NGN" },
    ];
    const result = buildPriceByStarTier(hotels);
    expect(result.find((t) => t.stars === 0)).toBeUndefined();
    expect(result).toHaveLength(1);
  });

  it("excludes hotels with a missing or non-numeric stars field", () => {
    const hotels = [
      { fromPricePerNight: 15000, fromPriceCurrency: "NGN" },
      { stars: "luxury", fromPricePerNight: 15000, fromPriceCurrency: "NGN" },
      { stars: 4, fromPricePerNight: 40000, fromPriceCurrency: "NGN" },
    ];
    const result = buildPriceByStarTier(hotels);
    expect(result).toHaveLength(1);
    expect(result[0].stars).toBe(4);
  });

  it("still counts a hotel with no live price, but leaves the tier price null if none in it have one", () => {
    const hotels = [
      { stars: 4, fromPricePerNight: null, fromPriceCurrency: null },
      { stars: 4, fromPricePerNight: null, fromPriceCurrency: null },
    ];
    const result = buildPriceByStarTier(hotels);
    expect(result[0]).toMatchObject({ stars: 4, fromPricePerNight: null, currency: null, hotelCount: 2 });
  });

  it("ignores unpriced hotels in a tier once a priced one sets the minimum", () => {
    const hotels = [
      { stars: 4, fromPricePerNight: null, fromPriceCurrency: null },
      { stars: 4, fromPricePerNight: 40000, fromPriceCurrency: "NGN" },
    ];
    const result = buildPriceByStarTier(hotels);
    expect(result[0]).toMatchObject({ fromPricePerNight: 40000, currency: "NGN", hotelCount: 2 });
  });

  it("returns an empty array for an empty hotel list", () => {
    expect(buildPriceByStarTier([])).toEqual([]);
  });
});