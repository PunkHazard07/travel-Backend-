import DuffelService from "../Config/duffel.js";
import { mapDuffelFlightOffer} from "../utils/mapper.js";

const duffelService = new DuffelService();

//helper send a consistent "not configured" response
const notConfigured = (res) =>
  res.status(503).json({
    success: false,
    error: {
      message: "Duffel API is not configured. Please check DUFFEL_KEY in your environment.",
      code: "SERVICE_UNAVAILABLE",
    },
  });
  

export const searchFlights = async (req, res) => {
  try {
        if (!duffelService.isConfigured()) return notConfigured(res);

      const {
      originLocationCode,
      destinationLocationCode,
      departureDate,
      returnDate,
      adults,
      children,
      infants,
      childrenAges,
      infantAges,
      travelClass,
      max,
      nonStop,
      airline, // optional filter
    } = req.body;

    //validation
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
        error: { message: "Invalid IATA code format for originLocationCode", code: "VALIDATION_ERROR" },
      });
    }

        if (!iataCodeRegex.test(destinationLocationCode)) {
      return res.status(400).json({
        success: false,
        error: { message: "Invalid IATA code format for destinationLocationCode", code: "VALIDATION_ERROR" },
      });
    }

    const parseAgeList = (ageList) => {
      if (Array.isArray(ageList)) return ageList.map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
      if (typeof ageList === "string") {
        return ageList
          .split(",")
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter(Number.isFinite);
      }
      return [];
    };

    const childCount = children ? parseInt(children, 10) : 0;
    const infantCount = infants ? parseInt(infants, 10) : 0;
    const childrenAgeList = parseAgeList(childrenAges);
    const infantAgeList = parseAgeList(infantAges);

    const isValidChildAge = (age) => Number.isInteger(age) && age >= 2 && age <= 11;
    const isValidInfantAge = (age) => Number.isInteger(age) && age >= 0 && age <= 2;

    if (childrenAgeList.length > 0 && childrenAgeList.length !== childCount) {
      return res.status(400).json({
        success: false,
        error: {
          message: "childrenAges must contain exactly as many entries as the children count",
          code: "VALIDATION_ERROR",
        },
      });
    }

    if (childrenAgeList.some((age) => !isValidChildAge(age))) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Each children age must be an integer between 2 and 11",
          code: "VALIDATION_ERROR",
        },
      });
    }

    if (infantAgeList.length > 0 && infantAgeList.length !== infantCount) {
      return res.status(400).json({
        success: false,
        error: {
          message: "infantAges must contain exactly as many entries as the infants count",
          code: "VALIDATION_ERROR",
        },
      });
    }

    if (infantAgeList.some((age) => !isValidInfantAge(age))) {
      return res.status(400).json({
        success: false,
        error: {
          message: "Each infant age must be an integer between 0 and 2",
          code: "VALIDATION_ERROR",
        },
      });
    }

    if (infantAgeList.length > 0 && infantAgeList.length !== infantCount) {
      return res.status(400).json({
        success: false,
        error: {
          message: "infantAges must contain exactly as many entries as the infants count",
          code: "VALIDATION_ERROR",
        },
      });
    }

    const searchParams = {
      originLocationCode: originLocationCode.toUpperCase(),
      destinationLocationCode: destinationLocationCode.toUpperCase(),
      departureDate,
      returnDate,
      adults: adults ? parseInt(adults, 10) : 1,
      children: childCount,
      infants: infantCount,
      childrenAges: childrenAgeList,
      infantAges: infantAgeList,
      travelClass,
      max: max ? parseInt(max, 10) : 50,
      nonStop: nonStop === "true" || nonStop === true,
    };

    //call service 
    const result = await duffelService.searchFlightOffers(searchParams);

      if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    //map offers
    let mappedOffers = result.data.map(mapDuffelFlightOffer);

    //airline filter
    if (airline) {
      const q = airline.trim().toLowerCase();
      mappedOffers = mappedOffers.filter((offer) => {
        const nameMatch = offer.carrierName?.toLowerCase().includes(q);
        const codeMatch = offer.carrierCode?.toLowerCase() === q;
        const validatingMatch = offer.validatingAirlineCodes?.some(
          (code) => code.toLowerCase() === q,
        );
        return nameMatch || codeMatch || validatingMatch;
      });
    }

    return res.status(200).json({
      success: true,
      data: mappedOffers,
      offerRequestedId: result.offerRequestId,
      meta: {count: mappedOffers.length},
    });

  } catch (error) {
    console.error("searchFlights error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An error occurred while searching for flights",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
};

export const searchAirports = async (req, res) => {
  try {
    if (!duffelService.isConfigured()) return notConfigured(res);

    const { keyword, max } = req.query;

    if (!keyword || keyword.length < 2) {
      return res.status(400).json({
        success: false,
        error: { message: "keyword must be at least 2 characters", code: "VALIDATION_ERROR" },
      });
    }

      const result = await duffelService.searchAirports({
      keyword: keyword.trim(),
      max: max ? parseInt(max) : 10,
    });

      if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("searchAirports error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An error occurred while searching for airports",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
}

export const getAirportByCode = async (req, res) => {
  try {
    if (!duffelService.isConfigured()) return notConfigured(res);

    const { iataCode } = req.params;

        if (!iataCode) {
      return res.status(400).json({
        success: false,
        error: { message: "Missing required parameter: iataCode", code: "VALIDATION_ERROR" },
      });
    }

    const result = await duffelService.getAirportByCode(iataCode);

    if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("getAirportByCode error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An error occurred while fetching airport information",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
};

export const getAirlineByCode = async (req, res) => {
  try {
    if (!duffelService.isConfigured()) return notConfigured(res);

    const { iataCode } = req.params;

        if (!iataCode) {
      return res.status(400).json({
        success: false,
        error: { message: "Missing required parameter: iataCode", code: "VALIDATION_ERROR" },
      });
    }

    const result = await duffelService.getAirlineByCode(iataCode);

    if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    //surface logo URL
    const airline = result.data?.[0] ?? null;
    return res.status(200).json({
      success: true,
      data: airline,
      logoLockupUrl: airline?.logo_lockup_url ?? null,
      logoSymbolUrl: airline?.logo_symbol_url ?? null,
    });
  } catch (error) {
    console.error("getAirlineByCode error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An error occurred while fetching airline information",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
};

//get seat map for offer 
export const getSeatMap = async (req, res) => {
  try {
    if (!duffelService.isConfigured()) return notConfigured(res);

    const { offerId } = req.params;

    if (!offerId) {
      return res.status(400).json({
        success: false,
        error: { message: "Missing required parameter: offerId", code: "VALIDATION_ERROR" },
      });
    }

    const result = await duffelService.getSeatMap(offerId);
      if (!result.success) {
      return res.status(result.error.status || 500).json(result);
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("getSeatMap error:", error);
    return res.status(500).json({
      success: false,
      error: {
        message: "An error occurred while fetching seat map information",
        code: "INTERNAL_SERVER_ERROR",
      },
    });
  }
};