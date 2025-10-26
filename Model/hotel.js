import mongoose from "mongoose";

const hotelSchema = new mongoose.Schema({
  apiHotelId: {
    type: String,
    required: true, 
    unique: true,
  },
  name: String,
  location: {
    city: String,
    country: String,
  },
  rating: Number,
  pricePerNight: Number, // optional, depends on what you cache
  image: String,
  description: String,
  cachedAt: {
    type: Date,
    default: Date.now,
    expires: 3600 * 6, // auto-delete after 6 hours (TTL cache)
  },
});

const Hotel = mongoose.model("Hotel", hotelSchema);
export default Hotel;
