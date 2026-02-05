import Amadeus from "amadeus";
import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();

class AmadeusService {
  constructor() {
    this.client = new Amadeus({
      clientId: process.env.AMADEUS_API_KEY,
      clientSecret: process.env.AMADEUS_SECRET_KEY,
      hostname:
        process.env.AMADEUS_ENVIRONMENT === "test" ? "test" : "production",
    });
  }

  /**
   * Search for flight offers (one-way or round-trip)
   * @param {Object} searchParams - Flight search parameters
   * @param {string} searchParams.originLocationCode
   * @param {string} searchParams.destinationLocationCode
   * @param {string} searchParams.departureDate
   * @param {string} [searchParams.returnDate]
   * @param {number} [searchParams.adults=1]
   * @param {number} [searchParams.children=0]
   * @param {number} [searchParams.infants=0]
   * @param {string} [searchParams.travelClass]
   * @param {number} [searchParams.max=250]
   * @param {string} [searchParams.currencyCode]
   * @param {boolean} [searchParams.nonStop=false]
   * @returns {Promise<Object>} Raw Amadeus API response with flight offers
   */
  async searchFlightOffers(searchParams) {
    try {
      const {
        originLocationCode,
        destinationLocationCode,
        departureDate,
        returnDate,
        adults = 1,
        children = 0,
        infants = 0,
        travelClass,
        max = 100,
        currencyCode,
        nonStop = false,
      } = searchParams;

      // Validate required parameters
      if (!originLocationCode || !destinationLocationCode || !departureDate) {
        throw new Error(
          "Missing required parameters: originLocationCode, destinationLocationCode, and departureDate are required",
        );
      }

      // Build request parameters
      const params = {
        originLocationCode,
        destinationLocationCode,
        departureDate,
        adults,
        max,
        nonStop,
      };

      // Add optional parameters if provided
      if (returnDate) params.returnDate = returnDate;
      if (children > 0) params.children = children;
      if (infants > 0) params.infants = infants;
      if (travelClass) params.travelClass = travelClass;
      if (currencyCode) params.currencyCode = currencyCode;

      const response =
        await this.client.shopping.flightOffersSearch.get(params);

      return {
        success: true,
        data: response.data,
        meta: response.meta || {},
        dictionaries: response.dictionaries || {},
      };
    } catch (error) {
      return this._handleError(error, "searchFlightOffers");
    }
  }

  /**
   * Search for airports by keyword
   * @param {Object} searchParams - Airport search parameters
   * @param {string} searchParams.keyword - Search keyword (city name, airport name, or IATA code)
   * @param {string} [searchParams.subType] - Location subtype: AIRPORT or CITY (default: AIRPORT)
   * @param {number} [searchParams.max=10]
   * @returns {Promise<Object>} Raw Amadeus API response with airport locations
   */
  async searchAirports(searchParams) {
    try {
      const { keyword, subType = "AIRPORT", max = 10 } = searchParams;

      // Validate required parameters
      if (!keyword) {
        throw new Error("Missing required parameter: keyword is required");
      }

      if (keyword.length < 1) {
        throw new Error("Keyword must be at least 1 character long");
      }

      const params = {
        keyword,
        subType: Array.isArray(subType) ? subType : [subType],
        "page[limit]": max,
      };

      const response = await this.client.referenceData.locations.get(params);

      return {
        success: true,
        data: response.data,
        meta: response.meta || {},
      };
    } catch (error) {
      return this._handleError(error, "searchAirports");
    }
  }

  /**
   * Get airport details by IATA code
   * @param {string} iataCode
   * @returns {Promise<Object>} Raw Amadeus API response with airport details
   */
  async getAirportByCode(iataCode) {
    try {
      if (!iataCode) {
        throw new Error("Missing required parameter: iataCode is required");
      }

      const response = await this.client.referenceData.location.get({
        keyword: iataCode,
        subType: "AIRPORT",
      });

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      return this._handleError(error, "getAirportByCode");
    }
  }

  /**
   * Handle and format API errors
   * @private
   */
  _handleError(error, methodName) {
    console.error(`AmadeusService.${methodName} error:`, error);

    // Amadeus API error
    if (error.response) {
      const { statusCode, body } = error.response;

      return {
        success: false,
        error: {
          message:
            body?.errors?.[0]?.detail ||
            body?.errors?.[0]?.title ||
            "Amadeus API error",
          code: body?.errors?.[0]?.code || "AMADEUS_ERROR",
          status: statusCode,
          details: body?.errors || [],
          source: "amadeus_api",
        },
      };
    }

    // Network or client error
    return {
      success: false,
      error: {
        message: error.message || "An unexpected error occurred",
        code: "SERVICE_ERROR",
        status: 500,
        source: "service_layer",
      },
    };
  }

  /**
   * Check if the Amadeus client is properly configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(process.env.AMADEUS_API_KEY && process.env.AMADEUS_SECRET_KEY);
  }
}

export default AmadeusService;
