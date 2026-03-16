import Booking from "../Model/booking.js";
import mongoose from "mongoose";

export const bookingService = {
  async simulateBookingProcess(bookingData) {
    return new Promise((resolve) => {
      setTimeout(() => {
        const confirmed = Math.random() > 0.05;
        resolve({
          success: confirmed,
          providerBookingId: `PROV-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
          status: confirmed ? "confirmed" : "failed",
        });
      }, 2000);
    });
  },

  //create flight booking
  async createFlightBooking(userId, flightData, totalPrice) {
    //validate flight data structure
    if (!flightData.itineraries || !Array.isArray(flightData.itineraries)) {
      throw new Error("Invalid flight itineraries");
    }

    //ensure at least one itinerary is present
    if (flightData.itineraries.length === 0) {
      throw new Error("Flight must contain at least one itinerary");
    }

    //validate each itinerary has segement
    flightData.itineraries.forEach((itinerary, index) => {
      if (
        !Array.isArray(itinerary.segments) ||
        itinerary.segments.length === 0
      ) {
        throw new Error(
          `Itinerary at index ${index} must contain at least one segment`,
        );
      }
    });

    //validate required flight data fields
    if (!flightData.offerId) {
      throw new Error("Flight offerId is required");
    }

    // validate price object
    if (!flightData.price?.currency) {
      throw new Error("Flight price currency is required");
    }

    const booking = new Booking({
      userId,
      bookingType: "flight",
      flightData: {
        offerId: flightData.offerId,
        source: flightData.source || "amadeus",
        validatingAirlineCodes: flightData.validatingAirlineCodes || [],
        itineraries: flightData.itineraries,
        price: {
          currency: flightData.price?.currency,
          total: flightData.price?.total || totalPrice,
          base: flightData.price?.base || totalPrice,
        },
        numberOfBookableSeats: flightData.numberOfBookableSeats,
      },
      totalPrice,
      status: "pending",
      paymentStatus: "unpaid",
    });
    await booking.save();
    return booking;
  },

  //create hotel booking
  async createHotelBooking(
    userId,
    hotelData,
    checkInDate,
    checkOutDate,
    totalPrice,
  ) {
    const booking = new Booking({
      userId,
      bookingType: "hotel",
      hotelData: {
        hotelName: hotelData.hotelName,
        hotelId: hotelData.hotelId,
        address: hotelData.address,
        city: hotelData.city,
        country: hotelData.country,
      },
      checkInDate,
      checkOutDate,
      totalPrice,
      status: "pending",
      paymentStatus: "unpaid",
    });
    await booking.save();
    return booking;
  },

  //confirm booking
  async confirmBooking(bookingId) {
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      throw new Error("Booking not found");
    }

    if (booking.status !== "pending") {
      throw new Error("Booking cannot be confirmed");
    }

    const providerResponse = await this.simulateBookingProcess(booking);

    booking.status = providerResponse.status;
    booking.providerBookingId = providerResponse.providerBookingId;
    booking.paymentStatus = providerResponse.success ? "paid" : "unpaid";

    await booking.save();
    return booking;
  },

  // Get user bookings
  async getUserBookings(userId, filters = {}) {
    const query = { userId: new mongoose.Types.ObjectId(userId) };

    if (filters.bookingType) {
      query.bookingType = filters.bookingType;
    }

    if (filters.status) {
      query.status = filters.status;
    }

    const bookings = await Booking.find(query).sort({ createdAt: -1 });
    return bookings;
  },

  // Cancel booking
  async cancelBooking(bookingId, userId) {
    const booking = await Booking.findOne({ _id: bookingId, userId: new mongoose.Types.ObjectId(userId) });

    if (!booking) {
      throw new Error("Booking not found");
    }

    if (booking.status === "cancelled") {
      throw new Error("Booking is already cancelled");
    }

    booking.status = "cancelled";
    booking.paymentStatus =
      booking.paymentStatus === "paid" ? "refunded" : "unpaid";

    await booking.save();
    return booking;
  },
};
