import AmadeusService from "../Config/amadeus.js";
import { mapAmadeusFlightOffer } from "../utils/mapper.js";

const amadeusService = new AmadeusService();

// Search for flight offers

export const searchFlights = async (req, res) => {
  try {
    // Check if service is configured
    if (!amadeusService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: {
          message:
            "Amadeus API is not configured. Please check environment variables.",
          code: "SERVICE_UNAVAILABLE",
        },
      });
    }

    // Extract and validate query parameters
    const {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      returnDate,
      adults,
      children,
      infants,
      travelClass,
      max,
      currencyCode,
      nonStop,
    } = req.body;

    // Validate required parameters
    if (!originLocationCode || !destinationLocationCode || !departureDate) {
      return res.status(400).json({
        success: false,
        error: {
          message:
            "Missing required parameters: originLocationCode, destinationLocationCode, and departureDate",
          code: "VALIDATION_ERROR",
        },
      });
    }

    // Build search parameters
    const searchParams = {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      returnDate,
      adults: adults ? parseInt(adults) : 1,
      children: children ? parseInt(children) : 0,
      infants: infants ? parseInt(infants) : 0,
      travelClass,
      max: max ? parseInt(max) : 100,
      currencyCode,
      nonStop: nonStop === "true",
    };

    // Call service
    const result = await amadeusService.searchFlightOffers(searchParams);

    // Handle service errors
    if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    // Map the flight offers
    const mappedOffers = result.data.map(mapAmadeusFlightOffer);

    // Return successful response
    return res.status(200).json({
      success: true,
      data: mappedOffers,
      meta: result.meta,
      dictionaries: result.dictionaries,
    });
  } catch (error) {
    console.error("searchFlights error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An unexpected error occurred while searching flights",
        code: "INTERNAL_ERROR",
      },
    });
  }
};

// Search for airports by keyword

export const searchAirports = async (req, res) => {
  try {
    // Check if service is configured
    if (!amadeusService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: {
          message:
            "Amadeus API is not configured. Please check environment variables.",
          code: "SERVICE_UNAVAILABLE",
        },
      });
    }

    const { keyword, subType, max } = req.query;

    // Validate required parameters
    if (!keyword) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Missing required parameter: keyword",
          code: "VALIDATION_ERROR",
        },
      });
    }

    // Build search parameters
    const searchParams = {
      keyword,
      subType: subType || "AIRPORT",
      max: max ? parseInt(max) : 10,
    };

    // Call service
    const result = await amadeusService.searchAirports(searchParams);

    // Handle service errors
    if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    // Return successful response
    return res.status(200).json(result);
  } catch (error) {
    console.error("searchAirports error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An unexpected error occurred while searching airports",
        code: "INTERNAL_ERROR",
      },
    });
  }
};

// Get airport details by IATA code

export const getAirportByCode = async (req, res) => {
  try {
    // Check if service is configured
    if (!amadeusService.isConfigured()) {
      return res.status(503).json({
        success: false,
        error: {
          message:
            "Amadeus API is not configured. Please check environment variables.",
          code: "SERVICE_UNAVAILABLE",
        },
      });
    }

    const { iataCode } = req.params;

    // Validate parameter
    if (!iataCode) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Missing required parameter: iataCode",
          code: "VALIDATION_ERROR",
        },
      });
    }

    // Call service
    const result = await amadeusService.getAirportByCode(iataCode);

    // Handle service errors
    if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    // Return successful response
    return res.status(200).json(result);
  } catch (error) {
    console.error("getAirportByCode error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An unexpected error occurred while fetching airport details",
        code: "INTERNAL_ERROR",
      },
    });
  }
};
