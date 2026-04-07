import express from "express";
import {
  searchFlights,
  searchAirports,
  getAirportByCode,
  getAirlineByCode,
  getSeatMap
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

/**
 * @route  GET /api/flights/airlines/:iataCode
 * @desc   Get airline details + logo URLs by IATA code
 * @access Public
 */
router.get("/airlines/:iataCode", getAirlineByCode);

/**
 * @route  GET /api/flights/seat-map/:offerId
 * @desc   Fetch seat map for a selected offer (bonus feature)
 * @access Public
 */
router.get("/seat-map/:offerId", getSeatMap);

export default router;
