import { bookingService } from "../Config/bookingService.js";
import { paystackService } from "../Config/paystackService.js";
import Hotel from "../Model/hotel.js";
import Booking from "../Model/booking.js";

//create flight booking
export const createFlightBooking = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { flightOffer, passengers, totalPrice } = req.body;

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
      source: flightOffer.source || "amadeus",
      validatingAirlineCodes: flightOffer.validatingAirlineCodes || [],
      itineraries: flightOffer.itineraries,
      price: {
        currency: flightOffer.price?.currency,
        total: flightOffer.price?.total || totalPrice,
        base: flightOffer.price?.base || totalPrice,
      },
      numberOfBookableSeats: flightOffer.numberOfBookableSeats,
      passengers,
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

// Initialize payment for booking
export const initializePayment = async (req, res) => {
  try {
    const { bookingId } = req.body;
    const userId = req.user?.id || req.userId;
    const userEmail = req.user?.email || req.body.email;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Booking ID is required",
      });
    }

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required for payment",
      });
    }

    // Find booking
    const booking = await Booking.findOne({ _id: bookingId, userId });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Check if already paid
    if (booking.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Booking has already been paid for",
      });
    }

    // Check if booking is cancelled
    if (booking.status === "cancelled") {
      return res.status(400).json({
        success: false,
        message: "Cannot pay for a cancelled booking",
      });
    }

    // Initialize Paystack payment
    const paymentData = await paystackService.initializePayment(
      userEmail,
      booking.totalPrice,
      booking.bookingReference,
      {
        bookingId: booking._id.toString(),
        bookingType: booking.bookingType,
        userId: userId.toString(),
      }
    );

    // Update booking with payment reference
    booking.paymentReference = paymentData.reference;
    booking.paymentMethod = "paystack";
    booking.paymentStatus = "processing";
    await booking.save();

    res.status(200).json({
      success: true,
      message: "Payment initialized successfully",
      data: {
        authorizationUrl: paymentData.authorizationUrl,
        reference: paymentData.reference,
        accessCode: paymentData.accessCode,
      },
    });
  } catch (error) {
    console.error("Initialize Payment Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to initialize payment",
    });
  }
};

// Verify payment and confirm booking
export const verifyPayment = async (req, res) => {
  try {
    const { reference } = req.query;
    const userId = req.user?.id || req.userId;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    // Verify payment with Paystack
    const paymentData = await paystackService.verifyPayment(reference);

    if (!paymentData.success) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    // Find booking by reference
    const booking = await Booking.findOne({
      paymentReference: reference,
    });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Update booking payment status
    booking.paymentStatus = "paid";
    booking.paymentReference = reference;
    booking.paymentMetadata = {
      paidAt: paymentData.paidAt,
      channel: paymentData.channel,
      amount: paymentData.amount,
    };

    // Confirm booking with provider (simulate)
    if (booking.status === "pending") {
      const providerResponse = await bookingService.simulateBookingProcess(booking);
      booking.status = providerResponse.status;
      booking.providerBookingId = providerResponse.providerBookingId;
    }

    await booking.save();

    res.status(200).json({
      success: true,
      message: "Payment verified and booking confirmed",
      data: booking,
    });
  } catch (error) {
    console.error("Verify Payment Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to verify payment",
    });
  }
};

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

