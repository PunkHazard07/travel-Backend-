import Booking from "../Model/booking.js";

export const bookingService = {
    async simulateBookingProcess(bookingData) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const confirmed = Math.random() > 0.2; 
                resolve({
                    success: confirmed,
                    providerBookingId:  `PROV-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
                    status: confirmed ? 'confirmed' : 'failed'
                });
            } , 2000);
        });
    },

    //create flight booking
    async createFlightBooking(userId, flightData, totalPrice) {
        const booking = new Booking({
            userId,
            bookingType: 'flight',
            flightData: {
                airline: flightData.airline,
                flightNumber: flightData.flightNumber,
                departure: {
                    airport: flightData.departureAirport,
                    city: flightData.departureCity,
                    date: flightData.departureDate,
                    time: flightData.departureTime
                },
                arrival: {
                    airport: flightData.arrivalAirport,
                    city: flightData.arrivalCity,
                    date: flightData.arrivalDate,
                    time: flightData.arrivalTime
                },
                passengers: flightData.passengers,
                class: flightData.class || 'Economy'
            },
            totalPrice,
            status: "pending",
            paymentStatus: "unpaid"
        });
        await booking.save();
        return booking;
    },

    //create hotel booking
    async createHotelBooking(userId, hotelData, checkInDate, checkOutDate, totalPrice) {
        const booking = new Booking({
            userId,
            bookingType: 'hotel',
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
            paymentStatus: "unpaid"
        });
        await booking.save();
        return booking;
    },

    //confirm booking
    async confirmBooking (bookingId) {
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            throw new Error('Booking not found');
        }

        if (booking.status !== 'pending') {
            throw new Error('Booking cannot be confirmed');
        }

        const providerResponse = await this.simulateBookingProcess(booking);

        booking.status = providerResponse.status;
        booking.providerBookingId = providerResponse.providerBookingId;
        booking.paymentStatus = providerResponse.success ? 'paid' : 'unpaid';

        await booking.save();
        return booking;
    },

     // Get user bookings
    async getUserBookings(userId, filters = {}) {
        const query = { userId };
        
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
        const booking = await Booking.findOne({ _id: bookingId, userId });
        
        if (!booking) {
            throw new Error("Booking not found");
        }

        if (booking.status === "cancelled") {
            throw new Error("Booking is already cancelled");
        }

        booking.status = "cancelled";
        booking.paymentStatus = booking.paymentStatus === "paid" ? "refunded" : "unpaid";

        await booking.save();
        return booking;
    }
}


