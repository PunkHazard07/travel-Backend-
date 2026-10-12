import { buildRoomOptions } from "../utils/hotelPricing.js";

const response = (roomTypes: any[]) => ({ data: [{ hotelId: "lp1", roomTypes }] });

const rate = (amount: number, extra: any = {}) => ({
  name: "Deluxe",
  boardName: "Room Only",
  maxOccupancy: 2,
  retailRate: { total: [{ amount, currency: "NGN" }], taxesAndFees: [] },
  cancellationPolicies: { refundableTag: "RFN" },
  ...extra,
});

describe("buildRoomOptions", () => {
  it("returns one option per room type, cheapest first", () => {
    const options = buildRoomOptions(
      response([
        { offerId: "o-expensive", roomTypeId: "r2", rates: [rate(300000)] },
        { offerId: "o-cheap", roomTypeId: "r1", rates: [rate(120000)] },
      ]),
      2,
      "NGN"
    );
    expect(options.map((o) => o.offerId)).toEqual(["o-cheap", "o-expensive"]);
    expect(options[0]).toMatchObject({ roomTypeId: "r1", total: 120000, perNight: 60000, currency: "NGN", nights: 2 });
  });

  it("uses the cheapest rate within a room type", () => {
    const options = buildRoomOptions(
      response([{ offerId: "o1", rates: [rate(200000), rate(150000, { name: "Saver" })] }]),
      1,
      "NGN"
    );
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ total: 150000, name: "Saver" });
  });

  it("adds taxes marked included: false to the total", () => {
    const withTax = rate(100000, {
      retailRate: {
        total: [{ amount: 100000, currency: "NGN" }],
        taxesAndFees: [{ included: false, amount: 5000, currency: "NGN" }],
      },
    });
    const options = buildRoomOptions(response([{ offerId: "o1", rates: [withTax] }]), 1, "NGN");
    expect(options[0].total).toBe(105000);
  });

  it("skips room types without an offerId", () => {
    const options = buildRoomOptions(response([{ rates: [rate(100000)] }]), 1, "NGN");
    expect(options).toEqual([]);
  });

  it("skips room types without a priced rate", () => {
    const options = buildRoomOptions(response([{ offerId: "o1", rates: [{ name: "x" }] }, { offerId: "o2", rates: [] }]), 1, "NGN");
    expect(options).toEqual([]);
  });

  it("maps the refundable tag", () => {
    const options = buildRoomOptions(
      response([
        { offerId: "a", rates: [rate(100000, { cancellationPolicies: { refundableTag: "RFN" } })] },
        { offerId: "b", rates: [rate(110000, { cancellationPolicies: { refundableTag: "NRFN" } })] },
        { offerId: "c", rates: [rate(120000, { cancellationPolicies: {} })] },
      ]),
      1,
      "NGN"
    );
    expect(options.map((o) => o.refundable)).toEqual([true, false, null]);
  });

  it("returns an empty list for an empty or missing response", () => {
    expect(buildRoomOptions({ data: [] }, 1, "NGN")).toEqual([]);
    expect(buildRoomOptions(undefined, 1, "NGN")).toEqual([]);
  });

  it("gives a null perNight for zero nights", () => {
    const options = buildRoomOptions(response([{ offerId: "o1", rates: [rate(100000)] }]), 0, "NGN");
    expect(options[0].perNight).toBeNull();
  });
});