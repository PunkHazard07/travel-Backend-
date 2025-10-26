import express from "express";
import { getFlights, getFlightById, searchFlightByNumber } from "../Controller/flightController.js";

const router = express.Router();

//get all flights
router.get("/getflight", getFlights);

//get all flight by MongDB ID
router.get('id/:id', getFlightById);

//search flight by flightnumber
router.get('/search/:flightNumber', searchFlightByNumber);

//export
export default router;