import {
  collectServicePrices,
  computeFlightTotal,
  FlightPriceError,
} from "../utils/flightPricing.js";

const offer = (overrides: any = {}) => ({
  total_amount: "250.50",
  total_currency: "GBP",
  available_services: [
    { id: "bag_1", total_amount: "30.00", total_currency: "GBP" },
    { id: "bag_2", total_amount: "45.25", total_currency: "GBP" },
  ],
  ...overrides,
});

const seatMaps = [
  {
    cabins: [
      {
        rows: [
          {
            sections: [
              {
                elements: [
                  { type: "seat", designator: "12A", available_services: [{ id: "seat_12A", total_amount: "15.00", total_currency: "GBP" }] },
                  { type: "empty" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe("collectServicePrices", () => {
  it("indexes services on the offer", () => {
    const prices = collectServicePrices(offer());
    expect(prices.get("bag_1")).toEqual({ amount: 30, currency: "GBP" });
    expect(prices.size).toBe(2);
  });

  it("finds services nested inside seat maps", () => {
    const prices = collectServicePrices(offer(), seatMaps);
    expect(prices.get("seat_12A")).toEqual({ amount: 15, currency: "GBP" });
    expect(prices.size).toBe(3);
  });

  it("skips malformed services", () => {
    const prices = collectServicePrices({
      available_services: [{ id: "a" }, { total_amount: "5", total_currency: "GBP" }, { id: "b", total_amount: "x", total_currency: "GBP" }],
    });
    expect(prices.size).toBe(0);
  });

  it("handles null and non-object sources", () => {
    expect(collectServicePrices(null, undefined, "x", 3).size).toBe(0);
  });
});

describe("computeFlightTotal", () => {
  it("returns the offer total when nothing extra is selected", () => {
    const total = computeFlightTotal(offer(), [], collectServicePrices(offer()));
    expect(total).toEqual({ currency: "GBP", offerTotal: 250.5, servicesTotal: 0, total: 250.5, services: [] });
  });

  it("adds selected services using Duffel's prices", () => {
    const o = offer();
    const total = computeFlightTotal(o, [{ id: "bag_1" }, { id: "bag_2" }], collectServicePrices(o));
    expect(total.servicesTotal).toBe(75.25);
    expect(total.total).toBe(325.75);
  });

  it("multiplies by quantity", () => {
    const o = offer();
    const total = computeFlightTotal(o, [{ id: "bag_1", quantity: 3 }], collectServicePrices(o));
    expect(total.servicesTotal).toBe(90);
    expect(total.services).toEqual([{ id: "bag_1", quantity: 3, amount: 90 }]);
  });

  it("prices seats from the seat map", () => {
    const o = offer();
    const total = computeFlightTotal(o, [{ id: "seat_12A" }], collectServicePrices(o, seatMaps));
    expect(total.total).toBe(265.5);
  });

  it("rejects a service Duffel does not list", () => {
    const o = offer();
    expect(() => computeFlightTotal(o, [{ id: "made_up" }], collectServicePrices(o))).toThrow(FlightPriceError);
    try {
      computeFlightTotal(o, [{ id: "made_up" }], collectServicePrices(o));
    } catch (e: any) {
      expect(e.code).toBe("unknown_service");
    }
  });

  it("rejects a service priced in a different currency", () => {
    const o = offer({ available_services: [{ id: "x", total_amount: "10", total_currency: "USD" }] });
    try {
      computeFlightTotal(o, [{ id: "x" }], collectServicePrices(o));
      throw new Error("should have thrown");
    } catch (e: any) {
      expect(e.code).toBe("service_currency_mismatch");
    }
  });

  it("rejects invalid quantities", () => {
    const o = offer();
    const prices = collectServicePrices(o);
    for (const quantity of [0, -1, 1.5, 11]) {
      expect(() => computeFlightTotal(o, [{ id: "bag_1", quantity }], prices)).toThrow(FlightPriceError);
    }
  });

  it("rejects a service without an id", () => {
    const o = offer();
    expect(() => computeFlightTotal(o, [{ id: "" } as any], collectServicePrices(o))).toThrow(FlightPriceError);
  });

  it("rejects an offer with no usable price", () => {
    for (const bad of [{ total_amount: "abc" }, { total_amount: "0" }, { total_amount: undefined }, { total_currency: "" }]) {
      try {
        computeFlightTotal({ ...offer(), ...bad }, [], new Map());
        throw new Error("should have thrown");
      } catch (e: any) {
        expect(e.code).toBe("offer_price_invalid");
      }
    }
  });

  it("rounds to 2 decimals", () => {
    const o = offer({ total_amount: "100.006", available_services: [{ id: "s", total_amount: "0.333", total_currency: "GBP" }] });
    const total = computeFlightTotal(o, [{ id: "s", quantity: 3 }], collectServicePrices(o));
    expect(total.servicesTotal).toBe(1);
    expect(total.total).toBe(101.01);
  });
});