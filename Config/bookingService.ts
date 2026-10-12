import mongoose from "mongoose";
import Booking, { type BookingDocument} from "../Model/booking.js";
import Hotel from "../Model/hotel.js";
import { BookingError } from "../utils/bookingError.js";
import { prebookOrThrow, bookHotel, prebookMaxAgeMs, type ProviderOutcome } from "../utils/hotelProvider.js";
import { simulateBookingProcess } from "../utils/flightSimulation.js";
import { hasPriceChanged, type HotelBookingInput } from "../utils/hotelBooking.js";

// Re-exported so the controllers' existing imports from this file keep working.
export { BookingError };
export type { ProviderOutcome };

export const bookingService = {
  async confirmWithProvider(booking: BookingDocument): Promise<ProviderOutcome> {
    if (booking.bookingType === "hotel") {
      return bookHotel(booking);
    }

    const simulated = await simulateBookingProcess(booking);
    return simulated.success ? { outcome: "confirmed", providerBookingId: simulated.providerBookingId }: { outcome: "failed", reason: "simulated_failure" };
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
      provider: "mock-provider",
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

    // Called before sending the customer to pay. If the prebook has gone
    // stale it is redone; the booking's total is always set from the fresh
    // authoritative price. `priceChanged` tells the caller the customer must
    // re-confirm the new amount.
    async refreshPrebookIfStale(booking: BookingDocument): Promise<{ refreshed: boolean; priceChanged: boolean; previousTotal?: number; newTotal?: number }> {
      if (booking.bookingType !== "hotel") {
        return { refreshed: false, priceChanged: false };
      }

      const age = booking.prebookedAt ? Date.now() - booking.prebookedAt.getTime() : Infinity;
      if (booking.prebookId && age < prebookMaxAgeMs()) {
        return { refreshed: false, priceChanged: false };
      }

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
        refreshed: true,
        priceChanged: hasPriceChanged(previousTotal, price.total),
        previousTotal,
        newTotal: price.total
      };
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
