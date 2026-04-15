import { Duffel } from "@duffel/api";
import dotenv from "dotenv";

dotenv.config();

class DuffelService {
  constructor() {
    this.client = new Duffel({
      token: process.env.DUFFEL_KEY
        });
  }

  isConfigured() {
    return !!process.env.DUFFEL_KEY;
  }

  //search for fligh offers (one way and round trip)
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
        childrenAges = [],
        infantAges = [],
        travelClass,
        max = 50,
        nonStop = false,
      } = searchParams

      // Validate required parameters
      if (!originLocationCode || !destinationLocationCode || !departureDate) {
        throw new Error("originLocationCode, destinationLocationCode, and departureDate are required");
      }

      // Validate date format (should be YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(departureDate)) {
        throw new Error("departureDate must be in YYYY-MM-DD format");
      }
      if (returnDate && !dateRegex.test(returnDate)) {
        throw new Error("returnDate must be in YYYY-MM-DD format");
      }

      const passengers = [];

      //add adults
      for (let i = 0; i < adults; i++) {
      passengers.push({ type: "adult" });
    }
    
     // Add children with ages
    for (let i = 0; i < children; i++) {
      const age = (childrenAges && childrenAges[i]) ? parseInt(childrenAges[i]) : 10;
      passengers.push({ 
        type: "child", 
        age: age  // Age must be a number, not a string
      });
    }

        // Add infants with ages
    for (let i = 0; i < infants; i++) {
      const age = (infantAges && infantAges[i]) ? parseInt(infantAges[i]) : 1;
      passengers.push({ 
        type: "infant", 
        age: age  // Age must be a number
      });
    }

      //build slices (Duffel's term for legs / directions)
      const slices = [
        {
          origin: originLocationCode,
          destination: destinationLocationCode,
          departure_date: departureDate,
        }
      ];

      //Add return slice if round-trips
      if (returnDate) {
        slices.push({
          origin: destinationLocationCode,
          destination: originLocationCode,
          departure_date: returnDate,
        });
      }

      //Cabin class name
        const cabinMap = {
        ECONOMY: "economy",
        PREMIUM_ECONOMY: "premium_economy",
        PREMIUMECONOMY: "premium_economy",
        BUSINESS: "business",
        FIRST: "first",
        economy: "economy",
        business: "business",
        first: "first",
      };

      const offerRequest = await this.client.offerRequests.create({
        slices,
        passengers,
        cabin_class: cabinMap[travelClass] || "economy"
      });

      const listParams = {
        offer_request_id: offerRequest.data.id,
        sort: "total_amount",
        limit: Math.min(max, 200)
      }

      if (nonStop === true) {
      listParams.max_connections = 0;
    }

      const offersResponse = await this.client.offers.list(listParams);

      return {
        success: true,
        data: offersResponse.data,
        offerRequestId: offerRequest.data.id,
      }
  } catch (error) {
    return this._handleError(error, "searchFlightOffers");
  }
}

async getOffer(offerId) {
  try {
    const response = await this.client.offers.get(offerId, {
      return_available_services: true,
    });
    return { success: true, data: response.data };
  } catch (error) {
    return this._handleError(error, "getOffer");
  }
}

async searchAirports(searchParams) {
  try {
    const { keyword, max = 10 } = searchParams;

    if (!keyword || keyword.trim().length < 1) {
      throw new Error("Keyword must be at least 1 character long");
    }

    const response = await this.client.places.suggest({
      query: keyword.trim()
    });

    const results = (response.data || [])
    .filter((p) => p.type === "airport" || p.type === "city")
    .slice(0, max);

    return {
      success: true,
      data: results,
    };
  } catch (error) {
    return this._handleError(error, "searchAirports");
  }
}

async getAirportByCode(iataCode) {
  try {
    if (!iataCode) throw new Error("iataCode is required");

    //duffel aiport enpoint 
    const response = await this.client.airports.list({
      iata_code: iataCode.toUpperCase(),
    });

    return { success: true, data: response.data };

  } catch (error) {
    return this._handleError(error, "getAirportByCode");
  }
}

async getAirlineByCode(iataCode) {
  try {
    if (!iataCode) throw new Error("iataCode is required");

    const response = await this.client.airlines.list({
      iata_code: iataCode.toUpperCase(),
    });

    return { success: true, data: response.data };

  } catch (error) {
    return this._handleError(error, "getAirlineByCode");
  }
}

async getSeatMap(offerId) {
    try {
      if (!offerId) throw new Error("offerId is required");

      const response = await this.client.seatMaps.get(offerId);

      return { success: true, data: response.data };
    } catch (error) {
      return this._handleError(error, "getSeatMap");
    }
  }

  _handleError(error, methodName) {
    console.error(`DuffelService.${methodName} error:`, error);

    // @duffel/api throws structured DuffelError objects
    if (error.errors && Array.isArray(error.errors)) {
      const first = error.errors[0] || {};
      return {
        success: false,
        error: {
          message: first.message || first.title || "Duffel API error",
          code: first.code || "DUFFEL_ERROR",
          status: error.meta?.status || 500,
          details: error.errors,
          source: "duffel_api",
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
}

export default DuffelService;
