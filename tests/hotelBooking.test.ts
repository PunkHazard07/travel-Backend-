import {
  isValidDateOnly,
  validateHotelBookingInput,
  computePrebookPrice,
  PrebookPriceError,
  hasPriceChanged,
  buildBookRequest,
  mapBookResponse,
} from "../utils/hotelBooking.js";

const TODAY = "2026-10-10";

const validBody = () => ({
  offerId: "offer-123",
  hotelId: "lp1234",
  hotelName: "Test Hotel",
  checkin: "2026-10-20",
  checkout: "2026-10-23",
  holder: { firstName: "Ada", lastName: "Obi", email: "ada@example.com", phone: "+2348000000000" },
});

describe("isValidDateOnly", () => {
  it("accepts a real date", () => {
    expect(isValidDateOnly("2026-10-20")).toBe(true);
  });
  it("rejects an impossible date", () => {
    expect(isValidDateOnly("2026-02-30")).toBe(false);
  });
  it("rejects a wrong format", () => {
    expect(isValidDateOnly("20/10/2026")).toBe(false);
    expect(isValidDateOnly("2026-10-20T00:00:00Z")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isValidDateOnly(undefined)).toBe(false);
    expect(isValidDateOnly(20261020)).toBe(false);
  });
});

describe("validateHotelBookingInput", () => {
  it("accepts a valid body and computes nights", () => {
    const result = validateHotelBookingInput(validBody(), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nights).toBe(3);
      expect(result.value.offerId).toBe("offer-123");
    }
  });

  it("defaults guests to the holder", () => {
    const result = validateHotelBookingInput(validBody(), TODAY);
    expect(result.ok && result.value.guests).toEqual([
      { occupancyNumber: 1, firstName: "Ada", lastName: "Obi", email: "ada@example.com" },
    ]);
  });

  it("forces every guest into occupancy 1", () => {
    const body: any = { ...validBody(), guests: [{ firstName: "A", lastName: "B", occupancyNumber: 5 }, { firstName: "C", lastName: "D" }] };
    const result = validateHotelBookingInput(body, TODAY);
    expect(result.ok && result.value.guests.map((g) => g.occupancyNumber)).toEqual([1, 1]);
  });

  it("allows a same-day check-in", () => {
    const body = { ...validBody(), checkin: TODAY, checkout: "2026-10-11" };
    expect(validateHotelBookingInput(body, TODAY).ok).toBe(true);
  });

  it("rejects a past check-in", () => {
    const body = { ...validBody(), checkin: "2026-10-09" };
    expect(validateHotelBookingInput(body, TODAY).ok).toBe(false);
  });

  it("rejects checkout on or before checkin", () => {
    expect(validateHotelBookingInput({ ...validBody(), checkout: "2026-10-20" }, TODAY).ok).toBe(false);
    expect(validateHotelBookingInput({ ...validBody(), checkout: "2026-10-19" }, TODAY).ok).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(validateHotelBookingInput({ ...validBody(), checkin: "2026-02-30" }, TODAY).ok).toBe(false);
  });

  it("rejects stays over 30 nights", () => {
    expect(validateHotelBookingInput({ ...validBody(), checkout: "2026-12-01" }, TODAY).ok).toBe(false);
  });

  it("requires offerId and hotelId", () => {
    const { offerId, ...noOffer } = validBody();
    const { hotelId, ...noHotel } = validBody();
    expect(validateHotelBookingInput(noOffer, TODAY).ok).toBe(false);
    expect(validateHotelBookingInput(noHotel, TODAY).ok).toBe(false);
  });

  it("requires a valid holder email", () => {
    const body = { ...validBody(), holder: { ...validBody().holder, email: "not-an-email" } };
    expect(validateHotelBookingInput(body, TODAY).ok).toBe(false);
  });

  it("requires holder names", () => {
    const body = { ...validBody(), holder: { ...validBody().holder, lastName: " " } };
    expect(validateHotelBookingInput(body, TODAY).ok).toBe(false);
  });

  it("rejects an empty guests array", () => {
    expect(validateHotelBookingInput({ ...validBody(), guests: [] }, TODAY).ok).toBe(false);
  });

  it("rejects a guest without a name", () => {
    expect(validateHotelBookingInput({ ...validBody(), guests: [{ firstName: "A" }] }, TODAY).ok).toBe(false);
  });

  it("rejects a non-positive expectedTotal", () => {
    expect(validateHotelBookingInput({ ...validBody(), expectedTotal: -5 }, TODAY).ok).toBe(false);
    expect(validateHotelBookingInput({ ...validBody(), expectedTotal: "abc" }, TODAY).ok).toBe(false);
  });

  it("keeps a valid expectedTotal", () => {
    const result = validateHotelBookingInput({ ...validBody(), expectedTotal: 150000 }, TODAY);
    expect(result.ok && result.value.expectedTotal).toBe(150000);
  });

  it("rejects a missing body", () => {
    expect(validateHotelBookingInput(undefined, TODAY).ok).toBe(false);
  });
});

describe("computePrebookPrice", () => {
  const rate = (overrides: any = {}) => ({
    roomTypes: [
      {
        rates: [
          {
            retailRate: {
              total: [{ amount: 100000, currency: "NGN" }],
              taxesAndFees: [],
              ...overrides,
            },
          },
        ],
      },
    ],
  });

  it("uses the NGN total", () => {
    const price = computePrebookPrice(rate());
    expect(price).toMatchObject({ total: 100000, currency: "NGN", basis: "retailRate" });
  });

  it("adds taxes marked included: false", () => {
    const price = computePrebookPrice(
      rate({ taxesAndFees: [{ included: false, amount: 7500, currency: "NGN" }] })
    );
    expect(price.total).toBe(107500);
  });

  it("does not add taxes marked included: true", () => {
    const price = computePrebookPrice(
      rate({ taxesAndFees: [{ included: true, amount: 7500, currency: "NGN" }] })
    );
    expect(price.total).toBe(100000);
  });

  it("ignores excluded taxes in another currency", () => {
    const price = computePrebookPrice(
      rate({ taxesAndFees: [{ included: false, amount: 50, currency: "USD" }] })
    );
    expect(price.total).toBe(100000);
  });

  it("throws rather than using a total in the wrong currency", () => {
    const data = rate({ total: [{ amount: 100, currency: "USD" }] });
    expect(() => computePrebookPrice(data)).toThrow(PrebookPriceError);
  });

  it("falls back to price when there is no rate detail and the currency matches", () => {
    const price = computePrebookPrice({ price: 98765.4321, currency: "NGN" });
    expect(price).toMatchObject({ total: 98765.43, basis: "price" });
  });

  it("does not fall back to price in another currency", () => {
    expect(() => computePrebookPrice({ price: 100, currency: "USD" })).toThrow(PrebookPriceError);
  });

  it("throws when nothing usable is present", () => {
    expect(() => computePrebookPrice({})).toThrow(PrebookPriceError);
    expect(() => computePrebookPrice(null)).toThrow(PrebookPriceError);
  });

  it("carries the reported price for comparison", () => {
    const data = { ...rate(), price: 100000 };
    expect(computePrebookPrice(data).reportedPrice).toBe(100000);
  });

  it("rounds to 2 decimals", () => {
    const price = computePrebookPrice(rate({ total: [{ amount: 100.006, currency: "NGN" }] }));
    expect(price.total).toBe(100.01);
  });
});

describe("hasPriceChanged", () => {
  it("is false for identical prices", () => {
    expect(hasPriceChanged(100000, 100000)).toBe(false);
  });
  it("is false within 0.5%", () => {
    expect(hasPriceChanged(100000, 100400)).toBe(false);
  });
  it("is true beyond 0.5%", () => {
    expect(hasPriceChanged(100000, 100600)).toBe(true);
  });
  it("uses a 1 naira floor for small totals", () => {
    expect(hasPriceChanged(100, 100.9)).toBe(false);
    expect(hasPriceChanged(100, 101.5)).toBe(true);
  });
  it("detects decreases too", () => {
    expect(hasPriceChanged(100000, 90000)).toBe(true);
  });
});

describe("buildBookRequest", () => {
  const params = {
    prebookId: "pb-1",
    holder: { firstName: "Ada", lastName: "Obi", email: "ada@example.com" },
    guests: [{ occupancyNumber: 1, firstName: "Ada", lastName: "Obi", email: "ada@example.com" }],
    clientReference: "BK-ABC1234567",
    paymentMethod: "ACC_CREDIT_CARD",
  };

  it("builds the book payload", () => {
    expect(buildBookRequest(params)).toEqual({
      prebookId: "pb-1",
      holder: params.holder,
      guests: [{ occupancyNumber: 1, firstName: "Ada", lastName: "Obi", email: "ada@example.com" }],
      payment: { method: "ACC_CREDIT_CARD" },
      clientReference: "BK-ABC1234567",
    });
  });

  it("omits guest email when absent", () => {
    const body = buildBookRequest({ ...params, guests: [{ occupancyNumber: 1, firstName: "C", lastName: "D" }] });
    expect(body.guests[0]).toEqual({ occupancyNumber: 1, firstName: "C", lastName: "D" });
  });

  it("defaults a missing occupancy number to 1", () => {
    const body = buildBookRequest({ ...params, guests: [{ occupancyNumber: 0, firstName: "C", lastName: "D" }] });
    expect(body.guests[0].occupancyNumber).toBe(1);
  });
});

describe("mapBookResponse", () => {
  it("maps a confirmed booking", () => {
    const out = mapBookResponse({
      bookingId: 4567,
      status: "CONFIRMED",
      hotelConfirmationCode: "H-99",
      supplierBookingId: "S-1",
    });
    expect(out).toEqual({
      confirmed: true,
      providerBookingId: "4567",
      status: "CONFIRMED",
      confirmationCode: "H-99",
      supplierBookingId: "S-1",
    });
  });

  it("is case-insensitive on status", () => {
    expect(mapBookResponse({ bookingId: "x", status: "confirmed" }).confirmed).toBe(true);
  });

  it("does not treat a non-confirmed status as confirmed", () => {
    expect(mapBookResponse({ bookingId: "x", status: "PENDING" }).confirmed).toBe(false);
  });

  it("does not treat a missing bookingId as confirmed", () => {
    expect(mapBookResponse({ status: "CONFIRMED" }).confirmed).toBe(false);
  });

  it("handles an empty response", () => {
    expect(mapBookResponse(undefined)).toMatchObject({ confirmed: false, providerBookingId: null, status: null });
  });
});