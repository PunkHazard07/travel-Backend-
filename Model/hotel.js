import mongoose from "mongoose";

const hotelSchema = new mongoose.Schema({
  apiHotelId: {
    type: String,
    required: true, 
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  location: {
    city: {
      type: String,
      required: true,
    },
    country: {
      type: String,
      required: true,
    },
  },
  rating: {
    type: Number,
    default: 0,
  },
  stars: {
    type: Number,
    default: 0,
  },
  pricePerNight: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
  },
  main_photo: String,
  thumbnail: String,
  hotelDescription: String,
  cachedAt: {
    type: Date,
    default: Date.now,
    expires: 3600 * 6, // 6 hours TTL
  },
}, {
  timestamps: true,
});

// / Create indexes for better query performance
hotelSchema.index({ "location.city": 1, "location.country": 1 });
hotelSchema.index({ rating: -1, pricePerNight: 1 });

const Hotel = mongoose.model("Hotel", hotelSchema);
export default Hotel;
