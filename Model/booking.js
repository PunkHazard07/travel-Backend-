//...booking model...
import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    bookingType: {
        type: String,
        enum: ["flight", "hotel"],
        required: true
    },
    flightId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Flight"
    },
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Hotel"
    }, 
    checkInDate: {type: Date},
    checkOutDate: {type: Date},
    status: {
        type: String,
        enum: ["pending", "confirmed", "cancelled"],
        default: "pending"
    },
    totalPrice: {type: Number},
    createdAt: {
        type: Date,
        default: Date.now
    },
});

bookingSchema.pre('save', function(next) {
    if (this.bookingType === 'flight' && !this.flightId) {
        return next(new Error('flightId is required for flight bookings'))
    }
    if (this.bookingType === 'hotel' && !this.hotelId) {
        return next(new Error('hotelId is required for hotel bookings'))
    }
    next();
});

const Booking = mongoose.model("Booking", bookingSchema);
export default Booking;