import { bookingService } from "../Config/bookingService.js";
import Hotel from "../Model/hotel.js";

//create flight booking
export const createFlightBooking = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { flightOffer, passengers, totalPrice, selectedServices } = req.body;

    //validate rquired fields
    if (!flightOffer || !passengers || !totalPrice) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    //validate passengers array
    if (!Array.isArray(passengers) || passengers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Passengers must be a non-empty array",
      });
    }

    //validate flightOffer has Amadeus structure
    if (!flightOffer.offerId) {
      return res.status(400).json({
        success: false,
        message: "Invalid flight offer data: missing offerId",
      });
    }

    const flightData = {
      offerId: flightOffer.offerId,
      source: flightOffer.source || "duffel",
      validatingAirlineCodes: flightOffer.validatingAirlineCodes || [],
      itineraries: flightOffer.itineraries,
      price: {
        currency: flightOffer.price?.currency,
        total: flightOffer.price?.total || totalPrice,
        base: flightOffer.price?.base || totalPrice,
      },
      numberOfBookableSeats: flightOffer.numberOfBookableSeats,
      passengers,
      selectedServices: selectedServices || []
    };

    //create booking
    const booking = await bookingService.createFlightBooking(
      userId,
      flightData,
      totalPrice
    );

    res.status(201).json({
      success: true,
      message: "Flight booking created successfully",
      data: booking,
    });
  } catch (error) {
    console.log("Error creating flight booking:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

//create hotel booking
export const createHotelBooking = async (req, res) => {
    try {
    const userId = req.user?.id || req.userId;
    const { hotelId, checkInDate, checkOutDate, totalPrice, guests } = req.body;

    // Validate required fields
    if (!hotelId || !checkInDate || !checkOutDate || !totalPrice) {
        return res.status(400).json({
        success: false,
        message:
        "Missing required fields: hotelId, checkInDate, checkOutDate, and totalPrice are required",
    });
    }

    // Validate dates
    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    if (checkIn >= checkOut) {
        return res.status(400).json({
        success: false,
        message: "Check-out date must be after check-in date",
    });
    }

    if (checkIn < new Date()) {
        return res.status(400).json({
        success: false,
        message: "Check-in date cannot be in the past",
    });
    }

    // Fetch hotel details from database
    const hotel = await Hotel.findById(hotelId);

    if (!hotel) {
        return res.status(404).json({
        success: false,
        message: "Hotel not found",
    });
    }
  
    const hotelData = {
        hotelName: hotel.name,
        hotelId: hotel._id,
        address: hotel.location?.address || "N/A",
        city: hotel.location?.city,
        country: hotel.location?.country,
        rating: hotel.rating,
        guests: guests || 1,
    };

    // Create booking
    const booking = await bookingService.createHotelBooking(
        userId,
        hotelData,
        checkIn,
        checkOut,
        totalPrice
    );

    res.status(201).json({
        success: true,
        message: "Hotel booking created successfully",
        data: booking,
    });
} catch (error) {
    console.error("Create Hotel Booking Error:", error);
    res.status(500).json({
        success: false,
        message: error.message || "Failed to create hotel booking",
    });
}
};

// initializePayment and verifyPayment moved to Controller/paymentController.ts

//get user bookings
export const getUserBookings = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { bookingType, status } = req.query;

    const filters = {};
    if (bookingType) {
      filters.bookingType = bookingType;
    }
    if (status) {
      filters.status = status;
    }

    const bookings = await bookingService.getUserBookings( userId, filters );

    res.status(200).json({
      success: true,
      data: bookings,
    });

  } catch (error) {
    console.error("Get User Bookings Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch user bookings",
    });
  }
};


//cancel booking
export const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user?.id || req.userId;
    const { reason } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID is required"
      });
    }

    const booking = await bookingService.cancelBooking(bookingId, userId);

    res.status(200).json({
      success: true,
      message: "Booking cancelled successfully",
      data: {
        booking,
        cancellationReason: reason || "User requested cancellation"
      }
    });

  } catch (error) {
    console.error("Cancel Booking Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to cancel booking"
    });
  }
};