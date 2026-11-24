import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const bookingUpdateOne = jest.fn<(...args: any[]) => Promise<any>>();
const prebookOrThrow = jest.fn<(...args: any[]) => Promise<any>>();
const duffelIsConfigured = jest.fn<() => boolean>();
const duffelGetOffer = jest.fn<(...args: any[]) => Promise<any>>();
const duffelGetSeatMap = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule("../Model/booking.js", () => ({
    __esModule: true,
    default: { updateOne: bookingUpdateOne },
}));
jest.unstable_mockModule("../Model/hotel.js", () => ({
    __esModule: true,
    default: { findOne: jest.fn() },
}));
jest.unstable_mockModule("../utils/hotelProvider.js", () => ({
    prebookOrThrow,
    bookHotel: jest.fn(),
}));
jest.unstable_mockModule("../utils/flightProvider.js", () => ({
    bookFlight: jest.fn(),
}));
jest.unstable_mockModule("../Config/duffel.js", () => ({
    __esModule: true,
    default: class MockDuffel {
        isConfigured() {
            return duffelIsConfigured();
        }
        getOffer(...args: any[]) {
            return duffelGetOffer(...args);
        }
        getSeatMap(...args: any[]) {
            return duffelGetSeatMap(...args);
        }
    },
}));

const { bookingService } = await import("../Config/bookingService.js");
const { BookingError } = await import("../utils/bookingError.js");

const FUTURE = new Date(Date.now() + 20 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

const makeOffer = (overrides: Record<string, any> = {}) => ({
    id: "off_1",
    total_amount: "500.00",
    total_currency: "GBP",
    base_amount: "450.00",
    expires_at: FUTURE,
    available_services: [{ id: "ser_bag", total_amount: "30.00", total_currency: "GBP" }],
    ...overrides,
});

const makeFlightBooking = (overrides: Record<string, any> = {}) => {
    const booking: any = {
        _id: "booking-1",
        bookingType: "flight",
        offerId: "off_1",
        totalPrice: 500,
        flightData: {
            offerId: "off_1",
            price: { currency: "GBP", total: 500 },
            selectedServices: [],
        },
        set: jest.fn(),
        save: jest.fn(async () => undefined),
        ...overrides,
    };
    return booking;
};

const makeHotelBooking = (overrides: Record<string, any> = {}) => ({
    _id: "booking-2",
    bookingType: "hotel",
    offerId: "rate_1",
    prebookId: "pre_old",
    prebookedAt: new Date(Date.now() - 60_000),
    totalPrice: 100000,
    save: jest.fn(async () => undefined),
    ...overrides,
}) as any;

const rejection = async (promise: Promise<unknown>) => {
    try {
        await promise;
    } catch (error) {
        return error as any;
    }
    throw new Error("expected the call to throw");
};

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    bookingUpdateOne.mockResolvedValue({});
    duffelIsConfigured.mockReturnValue(true);
    duffelGetOffer.mockResolvedValue({ success: true, data: makeOffer() });
});

describe("flight price revalidation", () => {
    it("unchanged price: reports no change and writes nothing", async () => {
        const booking = makeFlightBooking();

        const result = await bookingService.revalidateForPayment(booking);

        expect(duffelGetOffer).toHaveBeenCalledWith("off_1");
        expect(result).toEqual(
            expect.objectContaining({ revalidated: true, priceChanged: false, previousTotal: 500, newTotal: 500, currency: "GBP" })
        );
        expect(bookingUpdateOne).not.toHaveBeenCalled();
        expect(booking.totalPrice).toBe(500);
    });

    it("price increase: reports the change and stores the new total", async () => {
        duffelGetOffer.mockResolvedValue({ success: true, data: makeOffer({ total_amount: "550.00", base_amount: "500.00" }) });
        const booking = makeFlightBooking();

        const result = await bookingService.revalidateForPayment(booking);

        expect(result).toEqual(expect.objectContaining({ priceChanged: true, previousTotal: 500, newTotal: 550, currency: "GBP" }));
        expect(bookingUpdateOne).toHaveBeenCalledWith(
            { _id: "booking-1", paymentStatus: "unpaid" },
            { $set: { totalPrice: 550, "flightData.price": { currency: "GBP", total: 550, base: 500 } } }
        );
        expect(booking.totalPrice).toBe(550);
    });

    it("price decrease: also reported as a change", async () => {
        duffelGetOffer.mockResolvedValue({ success: true, data: makeOffer({ total_amount: "450.00", base_amount: "400.00" }) });
        const booking = makeFlightBooking();

        const result = await bookingService.revalidateForPayment(booking);

        expect(result).toEqual(expect.objectContaining({ priceChanged: true, previousTotal: 500, newTotal: 450 }));
        expect(bookingUpdateOne).toHaveBeenCalledTimes(1);
        expect(booking.totalPrice).toBe(450);
    });

    it("a one-cent difference counts as a change", async () => {
        duffelGetOffer.mockResolvedValue({ success: true, data: makeOffer({ total_amount: "500.01" }) });

        const result = await bookingService.revalidateForPayment(makeFlightBooking());

        expect(result.priceChanged).toBe(true);
    });

    it("currency change with the same number is a change", async () => {
        duffelGetOffer.mockResolvedValue({
            success: true,
            data: makeOffer({
                total_currency: "USD",
                available_services: [],
            }),
        });

        const result = await bookingService.revalidateForPayment(makeFlightBooking());

        expect(result).toEqual(expect.objectContaining({ priceChanged: true, currency: "USD", previousCurrency: "GBP" }));
    });

    it("includes the selected extras in the total it compares", async () => {
        const booking = makeFlightBooking({
            totalPrice: 530,
            flightData: {
                offerId: "off_1",
                price: { currency: "GBP", total: 500 },
                selectedServices: [{ id: "ser_bag", quantity: 1 }],
            },
        });

        const result = await bookingService.revalidateForPayment(booking);

        expect(result).toEqual(expect.objectContaining({ priceChanged: false, newTotal: 530 }));
        expect(duffelGetSeatMap).not.toHaveBeenCalled();
    });

    it("an extra that got more expensive is a change", async () => {
        duffelGetOffer.mockResolvedValue({
            success: true,
            data: makeOffer({ available_services: [{ id: "ser_bag", total_amount: "45.00", total_currency: "GBP" }] }),
        });
        const booking = makeFlightBooking({
            totalPrice: 530,
            flightData: {
                offerId: "off_1",
                price: { currency: "GBP", total: 500 },
                selectedServices: [{ id: "ser_bag", quantity: 1 }],
            },
        });

        const result = await bookingService.revalidateForPayment(booking);

        expect(result).toEqual(expect.objectContaining({ priceChanged: true, previousTotal: 530, newTotal: 545 }));
    });

    it("looks seats up in the seat map when the offer does not list them", async () => {
        duffelGetSeatMap.mockResolvedValue({
            success: true,
            data: [{ available_services: [{ id: "ser_seat", total_amount: "12.00", total_currency: "GBP" }] }],
        });
        const booking = makeFlightBooking({
            totalPrice: 512,
            flightData: {
                offerId: "off_1",
                price: { currency: "GBP", total: 500 },
                selectedServices: [{ id: "ser_seat", quantity: 1 }],
            },
        });

        const result = await bookingService.revalidateForPayment(booking);

        expect(duffelGetSeatMap).toHaveBeenCalledWith("off_1");
        expect(result).toEqual(expect.objectContaining({ priceChanged: false, newTotal: 512 }));
    });

    it("expired offer: throws OFFER_EXPIRED and writes nothing", async () => {
        duffelGetOffer.mockResolvedValue({ success: true, data: makeOffer({ expires_at: PAST }) });

        const error = await rejection(bookingService.revalidateForPayment(makeFlightBooking()));

        expect(error).toBeInstanceOf(BookingError);
        expect(error).toEqual(expect.objectContaining({ statusCode: 409, code: "OFFER_EXPIRED" }));
        expect(bookingUpdateOne).not.toHaveBeenCalled();
    });

    it.each([404, 410, 422])("Duffel answers %i: throws OFFER_UNAVAILABLE", async (status) => {
        duffelGetOffer.mockResolvedValue({ success: false, error: { status, message: "gone" } });

        const error = await rejection(bookingService.revalidateForPayment(makeFlightBooking()));

        expect(error).toEqual(expect.objectContaining({ statusCode: 409, code: "OFFER_UNAVAILABLE" }));
        expect(bookingUpdateOne).not.toHaveBeenCalled();
    });

    it("Duffel API failure: blocks with PROVIDER_UNAVAILABLE instead of trusting the stored price", async () => {
        duffelGetOffer.mockResolvedValue({ success: false, error: { status: 500, message: "boom" } });

        const error = await rejection(bookingService.revalidateForPayment(makeFlightBooking()));

        expect(error).toEqual(expect.objectContaining({ statusCode: 502, code: "PROVIDER_UNAVAILABLE" }));
        expect(bookingUpdateOne).not.toHaveBeenCalled();
    });

    it("Duffel not configured: blocks with 503", async () => {
        duffelIsConfigured.mockReturnValue(false);

        const error = await rejection(bookingService.revalidateForPayment(makeFlightBooking()));

        expect(error).toEqual(expect.objectContaining({ statusCode: 503, code: "PROVIDER_UNAVAILABLE" }));
        expect(duffelGetOffer).not.toHaveBeenCalled();
    });

    it("seat map failure: blocks with PROVIDER_UNAVAILABLE", async () => {
        duffelGetSeatMap.mockResolvedValue({ success: false, error: { status: 500, code: "internal" } });
        const booking = makeFlightBooking({
            flightData: {
                offerId: "off_1",
                price: { currency: "GBP", total: 500 },
                selectedServices: [{ id: "ser_seat", quantity: 1 }],
            },
        });

        const error = await rejection(bookingService.revalidateForPayment(booking));

        expect(error).toEqual(expect.objectContaining({ statusCode: 502, code: "PROVIDER_UNAVAILABLE" }));
    });

    it("a selected extra Duffel no longer lists: blocks with SERVICE_UNAVAILABLE", async () => {
        duffelGetSeatMap.mockResolvedValue({ success: false, error: { code: "seat_map_unavailable", status: 422 } });
        const booking = makeFlightBooking({
            flightData: {
                offerId: "off_1",
                price: { currency: "GBP", total: 500 },
                selectedServices: [{ id: "ser_gone", quantity: 1 }],
            },
        });

        const error = await rejection(bookingService.revalidateForPayment(booking));

        expect(error).toEqual(expect.objectContaining({ statusCode: 409, code: "SERVICE_UNAVAILABLE" }));
    });

    it("an offer with no usable price: blocks with PROVIDER_BAD_RESPONSE", async () => {
        duffelGetOffer.mockResolvedValue({ success: true, data: makeOffer({ total_amount: "not-a-number" }) });

        const error = await rejection(bookingService.revalidateForPayment(makeFlightBooking()));

        expect(error).toEqual(expect.objectContaining({ statusCode: 502, code: "PROVIDER_BAD_RESPONSE" }));
    });

    it("a booking with no offer id: blocks with OFFER_UNAVAILABLE", async () => {
        const booking = makeFlightBooking({ offerId: null, flightData: { price: { currency: "GBP" }, selectedServices: [] } });

        const error = await rejection(bookingService.revalidateForPayment(booking));

        expect(error).toEqual(expect.objectContaining({ statusCode: 409, code: "OFFER_UNAVAILABLE" }));
        expect(duffelGetOffer).not.toHaveBeenCalled();
    });
});

describe("hotel price revalidation", () => {
    const prebook = (total: number, prebookId = "pre_new") =>
        prebookOrThrow.mockResolvedValue({ prebookId, price: { total, currency: "NGN", basis: "retailRate" } });

    it("always asks LiteAPI again, even when the prebook is only a minute old", async () => {
        prebook(100000);
        const booking = makeHotelBooking();

        await bookingService.revalidateForPayment(booking);

        expect(prebookOrThrow).toHaveBeenCalledWith("rate_1");
        expect(booking.prebookId).toBe("pre_new");
        expect(booking.save).toHaveBeenCalledTimes(1);
    });

    it("unchanged price: no change reported", async () => {
        prebook(100000);

        const result = await bookingService.revalidateForPayment(makeHotelBooking());

        expect(result).toEqual(
            expect.objectContaining({ revalidated: true, priceChanged: false, previousTotal: 100000, newTotal: 100000, currency: "NGN" })
        );
    });

    it("price increase: reported and stored", async () => {
        prebook(120000);
        const booking = makeHotelBooking();

        const result = await bookingService.revalidateForPayment(booking);

        expect(result).toEqual(expect.objectContaining({ priceChanged: true, previousTotal: 100000, newTotal: 120000 }));
        expect(booking.totalPrice).toBe(120000);
    });

    it("price decrease: reported and stored", async () => {
        prebook(80000);
        const booking = makeHotelBooking();

        const result = await bookingService.revalidateForPayment(booking);

        expect(result).toEqual(expect.objectContaining({ priceChanged: true, previousTotal: 100000, newTotal: 80000 }));
        expect(booking.totalPrice).toBe(80000);
    });

    it("a rounding-sized difference is not a change, but the total still follows LiteAPI", async () => {
        prebook(100200);
        const booking = makeHotelBooking();

        const result = await bookingService.revalidateForPayment(booking);

        expect(result.priceChanged).toBe(false);
        expect(booking.totalPrice).toBe(100200);
    });

    it("rate no longer available: the error passes through and nothing is saved", async () => {
        prebookOrThrow.mockRejectedValue(new BookingError(409, "OFFER_UNAVAILABLE", "gone"));
        const booking = makeHotelBooking();

        const error = await rejection(bookingService.revalidateForPayment(booking));

        expect(error).toEqual(expect.objectContaining({ statusCode: 409, code: "OFFER_UNAVAILABLE" }));
        expect(booking.save).not.toHaveBeenCalled();
    });

    it("hotel provider down: blocks and saves nothing", async () => {
        prebookOrThrow.mockRejectedValue(new BookingError(503, "PROVIDER_UNAVAILABLE", "down"));
        const booking = makeHotelBooking();

        const error = await rejection(bookingService.revalidateForPayment(booking));

        expect(error).toEqual(expect.objectContaining({ statusCode: 503, code: "PROVIDER_UNAVAILABLE" }));
        expect(booking.save).not.toHaveBeenCalled();
    });

    it("a booking with no offer id can no longer be paid", async () => {
        const booking = makeHotelBooking({ offerId: null });

        const error = await rejection(bookingService.revalidateForPayment(booking));

        expect(error).toEqual(expect.objectContaining({ statusCode: 409, code: "PREBOOK_EXPIRED" }));
        expect(prebookOrThrow).not.toHaveBeenCalled();
    });
});