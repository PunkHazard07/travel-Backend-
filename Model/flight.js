//...Flight model...
import mongoose from "mongoose";

const flightSchema = new mongoose.Schema({
     flightNumber: {
        type: String,
        required: true,
     },
     airline:{
        type: String,
        required: true
     },
     departureAirport: {
        type: String,
        required: true
     },
     arrivalAirport: {
        type: String,
        required: true
     },
     departureTime: {
        type: Date,
        required: true
     },
     arrivalTime: {
        type: Date,
        required: true
     },
     status: {
        type: String,
        enum: [
            "scheduled",
            "on-time",
            "delayed",
            "cancelled",
            "departed",
            "landed"
        ],
        default: "scheduled"
     },
     currentLocation: {
        latitude: {type: Number},
        longitude: {type: Number}
     },
     gate: {
        type: String
     },
     terminal:{
        type: String
     },
     aircraftType:{
        type: String
     },
     lastUpdated: {
        type: Date,
        default: Date.now
     }, 
     
}, {timestamps: true});

// flightSchema.index({ flightNumber: 1 });
// flightSchema.index({ status: 1});
// flightSchema.index({ departureTime: 1 });

const Flight = mongoose.model("Flight", flightSchema);
export default Flight;