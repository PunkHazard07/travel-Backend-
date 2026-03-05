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
      airline
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

    const iataCodeRegex = /^[A-Z]{3}$/;

    if (!iataCodeRegex.test(originLocationCode)) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Invalid IATA code format for originLocationCode",
          code: "VALIDATION_ERROR",
        },
      });
    }

    if (!iataCodeRegex.test(destinationLocationCode)) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Invalid IATA code format for destinationLocationCode",
          code: "VALIDATION_ERROR",
        },
      });
    }

    // Build search parameters
    const searchParams = {
      originLocationCode: originLocationCode.toUpperCase(),
      destinationLocationCode: destinationLocationCode.toUpperCase(),
      departureDate,
      returnDate,
      adults: adults ? parseInt(adults) : 1,
      children: children ? parseInt(children) : 0,
      infants: infants ? parseInt(infants) : 0,
      travelClass,
      max: max ? parseInt(max) : 100,
      currencyCode,
      nonStop: nonStop === "true" || nonStop === true,
    };

    // Call service
    const result = await amadeusService.searchFlightOffers(searchParams);

    // Handle service errors
    if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    // Map the flight offers
    const dictionaries = result.dictionaries || {};

    // Map offers with carrier names resolved from dictionaries
    let mappedOffers = result.data.map((offer) =>
      mapAmadeusFlightOffer(offer, dictionaries)
    );

  if (airline) {
      const airlineQuery = airline.trim().toLowerCase();
      mappedOffers = mappedOffers.filter((offer) => {
        const nameMatch = offer.carrierName?.toLowerCase().includes(airlineQuery);
        const codeMatch = offer.carrierCode?.toLowerCase() === airlineQuery;
        // Also check all validating airline codes
        const validatingMatch = offer.validatingAirlineCodes?.some(
          (code) => code.toLowerCase() === airlineQuery
        );
        return nameMatch || codeMatch || validatingMatch;
      });
    }
    // Return successful response
    return res.status(200).json({
      success: true,
      data: mappedOffers,
      meta: result.meta,
      dictionaries
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

    if (keyword.length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Keyword must be at least 2 characters long",
          code: "VALIDATION_ERROR",
        },
      });
    }

    //handle subType from query string 
    let subTypeArray;
    if (subType) {
      if (typeof subType === 'string' && subType.includes(',')) {
        subTypeArray = subType.split(',').map(s => s.trim());
      } else {
        subTypeArray = [subType];
      }
    } else{
      subTypeArray = ["AIRPORT"];
    }
   

    // Build search parameters
    const searchParams = {
      keyword: keyword.trim(),
      subType: subTypeArray,
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
