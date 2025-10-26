import mongoose from "mongoose";

const flightSchema = new mongoose.Schema({
  apiFlightId: { 
    type: String,
    required: true,
    unique: true,
  },
  flightNumber: String,
  airline: String,
  departureAirport: String,
  arrivalAirport: String,
  departureTime: Date,
  arrivalTime: Date,
  status: String,
  cachedAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 30, // expires after 30 minutes (for cache)
  },
});

const Flight = mongoose.model("Flight", flightSchema);
export default Flight;