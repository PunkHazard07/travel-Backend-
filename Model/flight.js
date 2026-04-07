import mongoose from "mongoose";

const flightOfferSchema = new mongoose.Schema({
  offerId: {
    type: String,
    required: true,
    index: true,
  },
  source: {
    type: String,
    default: "DUFFEL",
  },
  
  // Basic flight info
  validatingAirlineCodes: [String],
  itineraries: [{
    duration: String,
    segments: [{
      departure: {
        iataCode: String,
        at: Date,
      },
      arrival: {
        iataCode: String,
        at: Date,
      },
      carrierCode: String,
      number: String,
      duration: String,
    }],
  }],
  
  // Pricing
  price: {
    currency: String,
    total: {
      type: Number,
      required: false,
    },
    base: Number,
  },
  
  numberOfBookableSeats: Number,
  
  // Cache management
  cachedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// TTL index - auto-delete after 30 minutes
flightOfferSchema.index({ cachedAt: 1 }, { expireAfterSeconds: 1800 });

// Query optimization
flightOfferSchema.index({ 
  "itineraries.segments.departure.iataCode": 1,
  "itineraries.segments.arrival.iataCode": 1,
  cachedAt: -1 
});

export default mongoose.model("FlightOffer", flightOfferSchema);