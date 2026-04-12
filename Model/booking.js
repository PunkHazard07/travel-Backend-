import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: "User"
    },
    bookingType: {
        type: String,
        required: true,
        enum: ["flight", "hotel"]
    },
    flightData: {
        offerId: {
            type: String,
        },
        source: {
            type: String,
            default: "duffel"
        },
        validatingAirlineCodes: [String],
        itineraries: [
            {
                duration: String,
                segments: [
                    {
                        departure: {
                            iataCode: String,
                            at: Date
                        },
                        arrival: {
                            iataCode: String,
                            at: Date
                        },
                        carrierCode: String,
                        number: String,
                        duration: String
                    }
                ]
            }
        ],
        price: {
            currency: String,
            total: Number,
            base: Number
        },
        numberOfBookableSeats: Number
    },
    hotelData: {
        type: Object,
        default: null
    },
    checkInDate: {
        type: Date,
    },
    checkOutDate: {
        type: Date,
    },
    bookingReference: {
        type: String,
        required: true,
        unique: true
    },
    provider: {
        type: String,
        default: "mock-provider"
    },
    providerBookingId: {
        type: String,
        default: null
    },
    status: {
        type: String,
        default: "pending",
        enum: ["pending", "confirmed", "cancelled", "failed"]
    },
    paymentStatus: {
        type: String,
        default: "unpaid",
        enum: ["unpaid", "paid", "refunded", "processing"]
    },
    paymentMethod: {
    type: String,
    enum: ['paystack'],
    default: null
    },
    paymentReference: {
        type: String,
        default: null
    },
    paymentMetadata: {
        type: Object,
        default: null
    },
    totalPrice: {
        type: Number,
        required: true  
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
})

bookingSchema.pre("validate", function (next) {
    if (!this.bookingReference) {
        this.bookingReference = 
        "BK-" + Math.random().toString(36).substring(2, 9).toUpperCase();
    }

    if(this.bookingType === "flight" && !this.flightData) {
        return next(new Error("Flight bookings require flightData"));
    }

    if (this.bookingType === "hotel" && !this.hotelData) {
        return next(new Error("Hotel bookings require hotelData"));
    }
    next();
})

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;