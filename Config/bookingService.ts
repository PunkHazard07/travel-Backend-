import mongoose from "mongoose";
import Booking, { type BookingDocument} from "../Model/booking.js";
import Hotel from "../Model/hotel.js";
import { BookingError } from "../utils/bookingError.js";
import { prebookOrThrow, bookHotel, prebookMaxAgeMs, type ProviderOutcome } from "../utils/hotelProvider.js";
import { bookFlight } from "../utils/flightProvider.js";
import { hasPriceChanged, SETTLEMENT_CURRENCY, type HotelBookingInput } from "../utils/hotelBooking.js";
import DuffelService from "./duffel.js";
import { fetchFlightQuote, FlightQuoteError } from "../utils/flightQuote.js";
import { FlightPriceError, isSamePrice } from "../utils/flightPricing.js";

// Re-exported so the controllers' existing imports from this file keep working.
export { BookingError };
export type { ProviderOutcome };

// What a pre-payment price check found. `previousTotal` / `newTotal` are in
// `currency` (Duffel's currency for flights, naira for hotels).
export interface PriceRevalidation {
  revalidated: boolean;
  priceChanged: boolean;
  previousTotal: number;
  newTotal: number;
  currency: string;
  previousCurrency?: string;
}

let duffelService: DuffelService | null = null;
const getDuffel = (): DuffelService => {
  if (!duffelService) duffelService = new DuffelService();
  return duffelService;
};

// Asks LiteAPI for a fresh prebook EVERY time payment is about to start, so the
// charge is never built from a stored price. The booking's total is always set
// from the fresh authoritative price; `priceChanged` tells the caller the
// customer must re-confirm the new amount.
const refreshHotelPrebook = async (booking: BookingDocument): Promise<PriceRevalidation> => {
  if (!booking.offerId) {
    throw new BookingError(409, "PREBOOK_EXPIRED", "This booking can no longer be paid. Please search again.");
  }

  const { prebookId, price } = await prebookOrThrow(booking.offerId);
  const previousTotal = booking.totalPrice;

  booking.prebookId = prebookId;
  booking.prebookedAt = new Date();
  booking.totalPrice = price.total;
  await booking.save();

  return {
    revalidated: true,
    priceChanged: hasPriceChanged(previousTotal, price.total),
    previousTotal,
    newTotal: price.total,
    currency: SETTLEMENT_CURRENCY
  };
};

// Asks Duffel what the offer costs right now (offer + the extras the customer
// picked). Fails closed: if Duffel can't be reached, or the offer is expired or
// gone, this throws and payment must not start.
const revalidateFlightPrice = async (booking: BookingDocument): Promise<PriceRevalidation> => {
  const offerId = booking.offerId ?? booking.flightData?.offerId;
  if (!offerId) {
    throw new BookingError(409, "OFFER_UNAVAILABLE", "This flight offer is no longer available. Please search again.");
  }

  const selected = (booking.flightData?.selectedServices ?? []).map((s: any) => ({ id: s?.id, quantity: s?.quantity }));

  let quote;
  try {
    quote = await fetchFlightQuote(getDuffel(), offerId, selected);
  } catch (error) {
      if (error instanceof FlightQuoteError) {
      switch (error.code) {
        case "offer_unavailable":
          throw new BookingError(409, "OFFER_UNAVAILABLE", error.message);
        case "offer_expired":
          throw new BookingError(409, "OFFER_EXPIRED", error.message);
        case "provider_not_configured":
          throw new BookingError(503, "PROVIDER_UNAVAILABLE", error.message);
        default:
          throw new BookingError(502, "PROVIDER_UNAVAILABLE", error.message);
      }
    }
    if (error instanceof FlightPriceError) {
      if (error.code === "offer_price_invalid") {
        throw new BookingError(502, "PROVIDER_BAD_RESPONSE", "Could not determine the current price for this flight.");
      }
      // A selected extra (bag, seat) is no longer listed by Duffel.
      throw new BookingError(409, "SERVICE_UNAVAILABLE", "One of your selected extras is no longer available. Please review your booking.");
    }
    throw error;
  }

  const previousTotal = booking.totalPrice;
  const previousCurrency = booking.flightData?.price?.currency;
  const { total, offer } = quote;

  const currencyChanged = Boolean(previousCurrency) && previousCurrency!.toUpperCase() !== total.currency.toUpperCase();
  const priceChanged = currencyChanged || !isSamePrice(previousTotal, total.total);

  if (priceChanged) {
    const newPrice = {
      currency: total.currency,
      total: total.offerTotal,
      base: Number.parseFloat(offer.base_amount) || total.offerTotal
    };

    // Conditional on unpaid so a payment that settles meanwhile is never overwritten.
    await Booking.updateOne (
      { _id: booking._id, paymentStatus: "unpaid" },
      { $set: { totalPrice: total.total, "flightData.price": newPrice } }
    );
    booking.totalPrice = total.total;
    booking.set("flightData.price", newPrice);
  }
  return {
    revalidated: true,
    priceChanged,
    previousTotal,
    newTotal: total.total,
    currency: total.currency,
    ...(currencyChanged ? { previousCurrency } : {})
  };
};

export const bookingService = {
  async confirmWithProvider(booking: BookingDocument): Promise<ProviderOutcome> {
    if (booking.bookingType === "hotel") {
      return bookHotel(booking);
    }

    return bookFlight(booking);
  },

  // Creates a flight booking. `totalPrice` must already be the
  // server-derived total (see utils/flightPricing.ts), never client input.
  async createFlightBooking(userId: string, flightData: any, totalPrice: number): Promise<BookingDocument> {
    if (!flightData.itineraries || !Array.isArray(flightData.itineraries)) {
      throw new BookingError(400, "INVALID_FLIGHT", "Invalid flight itineraries");
    }
    if (flightData.itineraries.length === 0) {
      throw new BookingError(400, "INVALID_FLIGHT", "Flight must contain at least one itinerary");
    }
    flightData.itineraries.forEach((itinerary: any, index: number) => {
      if (!Array.isArray(itinerary.segments) || itinerary.segments.length === 0) {
        throw new BookingError(400, "INVALID_FLIGHT", `Itinerary at index ${index} must contain at least one segment`);
      }
    });
    if (!flightData.offerId) {
      throw new BookingError(400, "INVALID_FLIGHT", "Flight offerId is required");
    }
    if (!flightData.price?.currency) {
      throw new BookingError(400, "INVALID_FLIGHT", "Flight price currency is required");
    }

    const booking = new Booking({
      userId,
      bookingType: "flight",
      provider: "Duffel",
      offerId: flightData.offerId,
      flightData: {
        offerId: flightData.offerId,
        source: flightData.source || "duffel",
        validatingAirlineCodes: flightData.validatingAirlineCodes || [],
        itineraries: flightData.itineraries,
        price: flightData.price,
        numberOfBookableSeats: flightData.numberOfBookableSeats,
        selectedServices: flightData.selectedServices || [],
        passengers: flightData.passengers || []
      },
      totalPrice,
      status: "pending",
      paymentStatus: "unpaid"
    });
    await booking.save();
    return booking;
  },

  async createHotelBooking(userId: string, input: HotelBookingInput): Promise<BookingDocument> {
    const { prebookId, price } = await prebookOrThrow(input.offerId);

    if (input.expectedTotal !== undefined && hasPriceChanged(input.expectedTotal, price.total)) {
        throw new BookingError(409, "PRICE_CHANGED", "The price for this room has changed.", {
          expectedTotal: input.expectedTotal,
          newTotal: price.total,
          currency: price.currency
        });
    }

    const hotel: any = await Hotel.findOne({ apiHotelId: input.hotelId }).lean();

    const booking = new Booking({
      userId,
      bookingType: "hotel",
      provider: "liteapi",
      offerId: input.offerId,
      prebookId,
      prebookedAt: new Date(),
      hotelData: {
        apiHotelId: input.hotelId,
        hotelName: hotel?.name ?? input.hotelName ?? null,
        city: hotel?.location?.city ?? null,
        country: hotel?.location?.country ?? null,
        stars: hotel?.stars ?? null,
        checkin: input.checkin,
        checkout: input.checkout,
        nights: input.nights,
        holder: input.holder,
        guests: input.guests,
        pricing: { currency: price.currency, basis: price.basis },
          },
        checkInDate: new Date(`${input.checkin}T00:00:00Z`),
        checkOutDate: new Date(`${input.checkout}T00:00:00Z`),
        totalPrice: price.total,
        status: "pending",
        paymentStatus: "unpaid",
    });
    await booking.save();
    return booking;
  },

    // Called before sending the customer to pay, every time. Re-checks the
    // supplier's CURRENT price (LiteAPI prebook for hotels, Duffel offer for
    // flights) and sets the booking's total from it. `priceChanged` tells the
    // caller the customer must confirm the new amount before paying
    async revalidateForPayment(booking: BookingDocument): Promise<PriceRevalidation> {
      return booking.bookingType === "flight" ? revalidateFlightPrice(booking) : refreshHotelPrebook(booking);
    },

    async getUserBookings(userId: string, filters: { bookingType?: string; status?: string } = {}): Promise<BookingDocument[]> {
      const query: Record<string, any> = { userId: new mongoose.Types.ObjectId(String(userId)) };

        if (filters.bookingType) query.bookingType = filters.bookingType;
        if (filters.status) query.status = filters.status;

        return await Booking.find(query).sort({ createdAt: -1 });
    },

    async cancelBooking(bookingId: string, userId: string): Promise<BookingDocument> {
        if (!mongoose.isValidObjectId(bookingId)) {
            throw new BookingError(404, "NOT_FOUND", "Booking not found");
        }

        const booking = await Booking.findOne({ _id: bookingId, userId: new mongoose.Types.ObjectId(String(userId)) });

        if (!booking) {
            throw new BookingError(404, "NOT_FOUND", "Booking not found");
        }

        if (booking.status === "cancelled") {
            throw new BookingError(409, "ALREADY_CANCELLED", "Booking is already cancelled");
        }

        // A paid booking needs a real provider cancellation and a real
        // Paystack refund. Neither exists yet, so flipping the status here
        // would tell the customer they were refunded when they weren't.
        // TODO(refund-batch): LiteAPI cancel + paystackService.processRefund.
        if (booking.paymentStatus === "paid" || booking.paymentStatus === "flagged") {
            throw new BookingError(
                409,
                "CANCEL_PAID_UNSUPPORTED",
                "Paid bookings can't be cancelled online yet. Please contact support."
            );
        }

        booking.status = "cancelled";
        await booking.save();
        return booking;
    }
}
