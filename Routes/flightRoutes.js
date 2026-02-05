import express from "express";
import {
  searchFlights,
  searchAirports,
  getAirportByCode,
} from "../Controller/flightController.js";

const router = express.Router();
//search flights route
/**
 * @route   GET /api/flights/search
 * @desc    Search for flight offers
 * @access  Public
 */

router.post("/search", searchFlights);
// search airports route
/**
 * @route   GET /api/flights/airports/search
 * @desc    Search for airports by keyword
 * @access  Public
 */

router.get("/airports/search", searchAirports);

// get airport by IATA code route
/**
 * @route   GET /api/flights/airports/:iataCode
 * @desc    Get airport details by IATA code
 * @access  Public
 */

router.get("/airports/:iataCode", getAirportByCode);

export default router;
