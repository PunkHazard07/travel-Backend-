import express from "express";
import {
  getFlights,
  getFlightById,
  searchFlightByNumber,
  getFlightsByAirline,
  getFlightsByRoute,
} from "../Controller/flightController.js";

const router = express.Router();

//get all flights
router.get("/getflight", getFlights); //...working...

//get all flight by MongDB ID
router.get("/id/:id", getFlightById);

//search flight by flightnumber
router.get("/search/:flightNumber", searchFlightByNumber);

//get flight by airline
router.get("/airline/:airline", getFlightsByAirline);

//get flight by route
router.get("/route/:depIata/:arrIata", getFlightsByRoute);

//export
export default router;
