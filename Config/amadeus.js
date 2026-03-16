import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

class AmadeusService {
  constructor() {
    this.baseURL = "https://test.api.amadeus.com";
    this.clientId = process.env.AMADEUS_API_KEY;
    this.clientSecret = process.env.AMADEUS_SECRET_KEY;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get access token
   */
  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(
        `${this.baseURL}/v1/security/oauth2/token`,
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        }
      );

      this.accessToken = response.data.access_token;
      // Set expiry to 5 minutes before actual expiry (usually 30 minutes)
      this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

      console.log("✅ Amadeus access token obtained");
      return this.accessToken;
    } catch (error) {
      console.error("Failed to get access token:", error.response?.data || error.message);
      throw new Error("Failed to authenticate with Amadeus API");
    }
  }

  /**
   * Search for flight offers
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

      if (!originLocationCode || !destinationLocationCode || !departureDate) {
        throw new Error(
          "Missing required parameters: originLocationCode, destinationLocationCode, and departureDate are required"
        );
      }

      const token = await this.getAccessToken();

      const params = {
        originLocationCode,
        destinationLocationCode,
        departureDate,
        adults,
        max,
        nonStop,
      };

      if (returnDate) params.returnDate = returnDate;
      if (children > 0) params.children = children;
      if (infants > 0) params.infants = infants;
      if (travelClass) params.travelClass = travelClass;
      if (currencyCode) params.currencyCode = currencyCode;

      const response = await axios.get(
        `${this.baseURL}/v2/shopping/flight-offers`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params,
        }
      );

      return {
        success: true,
        data: response.data.data,
        meta: response.data.meta || {},
        dictionaries: response.data.dictionaries || {},
      };
    } catch (error) {
      return this._handleError(error, "searchFlightOffers");
    }
  }

   
_cleanKeyword(keyword) {
  if (!keyword) return "";
  
  // Extract IATA code from parentheses if present
  const iataMatch = keyword.match(/\(([A-Z]{3})\)/);
  if (iataMatch) {
    console.log(`Extracted: ${iataMatch[1]} from: ${keyword}`);
    return iataMatch[1];
  }
  
  // Otherwise truncate to 10 chars
  const cleaned = keyword.trim().substring(0, 10);
  console.log(`Truncated: "${cleaned}" from: "${keyword}"`);
  return cleaned;
}
   

  /**
   * Search for airports by keyword
   */
  async searchAirports(searchParams) {
    try {
      const { keyword, subType = "AIRPORT", max = 10 } = searchParams;

      console.log("searchAirports called with:", searchParams);

      if (!keyword || keyword.length < 1) {
        throw new Error("Keyword must be at least 1 character long");
      }

      const originalKeyword = keyword;
      const cleanedKeyword = this._cleanKeyword(keyword);

      if (cleanedKeyword.length < 1) {
        throw new Error ("cleaned Keyword is too short ");
      }

      const token = await this.getAccessToken();

      let subTypeParam;
      if (Array.isArray(subType)) {
        subTypeParam = subType.join(",");
      } else {       
        subTypeParam = subType;
      }

    const url = `${this.baseURL}/v1/reference-data/locations?keyword=${encodeURIComponent(cleanedKeyword)}&subType=${subTypeParam}&page[limit]=${max}`;
        

    console.log(" Amadeus API call:", {
        originalKeyword,
        cleanedKeyword,
        subType: subTypeParam,
        max,
        fullUrl: url
      });
      const response = await axios.get(
        url,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return {
        success: true,
        data: response.data.data,
        meta: response.data.meta || {},
      };
    } catch (error) {
      return this._handleError(error, "searchAirports");
    }
  }

  /**
   * Get airport details by IATA code
   */
  async getAirportByCode(iataCode) {
    try {
      if (!iataCode) {
        throw new Error("Missing required parameter: iataCode is required");
      }

      const token = await this.getAccessToken();

      const response = await axios.get(
        `${this.baseURL}/v1/reference-data/locations`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            keyword: iataCode,
            subType: "AIRPORT",
          },
        }
      );

      return {
        success: true,
        data: response.data.data,
      };
    } catch (error) {
      return this._handleError(error, "getAirportByCode");
    }
  }

  /**
   * Handle and format API errors
   */
  _handleError(error, methodName) {
    console.error(`AmadeusService.${methodName} error:`, error.response?.data || error.message);

    if (error.response) {
      const { status, data } = error.response;
      
      return {
        success: false,
        error: {
          message:
            data?.errors?.[0]?.detail ||
            data?.errors?.[0]?.title ||
            error.message ||
            "Amadeus API error",
          code: data?.errors?.[0]?.code || "AMADEUS_ERROR",
          status,
          details: data?.errors || [],
          source: "amadeus_api",
        },
      };
    }

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
   * Check if the service is properly configured
   */
  isConfigured() {
    return !!(this.clientId && this.clientSecret);
  }

}

export default AmadeusService;