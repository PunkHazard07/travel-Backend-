//...Hotel model...
import mongoose from "mongoose";

const roomSchema = new mongoose.Schema({
    roomType: {
        type: String,
        required: true
    },
    pricePerNight: {
        type: Number,
        required: true
    },
    capacity: {
        type: Number,
        required: true
    },
    available: {
        type: Boolean,
        default: true
    }
});

const hotelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    location: {
        city: {
            type: String,
            required: true
        },
        country: {
            type: String,
            required: true
        },
        address: {
            type: String
        }
    },
    rating: {
        type: Number,
        min: 0,
        max: 5
    },
    rooms: [roomSchema],
    contact: {
        phone: {type: String},
        email: {type: String}
    },
    images: [{type: String}],
    description: {type: String}
});

hotelSchema.index({"location.city": 1, 'loation.country': 1});

const Hotel = mongoose.model("Hotel", hotelSchema);
export default Hotel;