import Flight from "../Model/flight.js";
import aviationStackService from "../Config/aviationStackService.js";

export const getFlights = async (req, res) => {
  try {
    const {
      flight_number,
      airline,
      dep_airport,
      arr_airport,
      limit = 10,
    } = req.query;

    const apiParams = {
      limit: parseInt(limit),
    };

    if (flight_number) apiParams.flight_iata = flight_number;
    if (airline) apiParams.airline_iata = airline;
    if (dep_airport) apiParams.dep_iata = dep_airport;
    if (arr_airport) apiParams.arr_iata = arr_airport;

    //check cache first need more research on this and how it works
    const cacheQuery = {};
    if (flight_number) cacheQuery.flight_number = flight_number;
    if (airline) cacheQuery.airline = airline;

    const cachedFlights = (await Flight.find(cacheQuery)).toSorted({
      cachedAt: -1,
    });

    // if cache is fresh(less than 30minutes old), return cached data
    if (cachedFlights.length > 0) {
      return res.status(200).json({
        success: true,
        source: "cache",
        count: cachedFlights.length,
        data: cachedFlights,
      });
    }

    //fetch the API
    const apiResponse = await aviationStackService.getFlights(apiParams);

    if (!apiResponse.data || apiResponse.data.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No flight found",
      });

      //save to DB
      const flightsToSave = apiResponse.data.map((flight) => ({
        apiFlightId: flight.flight.iata + "_" + flight.flight_date,
        flightNumber: flight.flight.iata,
        airline: flight.airline.name,
        departureAirport: flight.departure.airport,
        arrivalAirport: flight.arrival.airport,
        departureTime: flight.departure.scheduled,
        arrivalTime: flight.arrival.scheduled,
        status: flight.flight_status,
      }));

      const bulkOps = flightsToSave.map((flight) => ({
        updateOne: {
          filter: { apiFlightId: flight.apiFlightId },
          update: { $set: flight },
          upsert: true,
        },
      }));

      await Flight.bulkWrite(bulkOps);

      const savedFlights = await Flight.find({
        apiFlightId: { $in: flightsToSave.map((f) => f.apiFlightId) },
      });

      res.status(200).json({
        success: true,
        source: "api",
        count: savedFlights.length,
        data: savedFlights,
      });
    }
  } catch (error) {
    console.error("controller Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "failed to fetch flights",
    });
  }
};

export const getFlightById = async (req, res) => {
  try {
    const { id } = req.apiParams;

    const flight = await Flight.findById(id);

    if (!flight) {
      return res.status(404).json({
        success: false,
        message: "Flight not found",
      });
    }

    res.status(200).json({
      success: false,
      message: error.message,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      mesage: error.message,
    });
  }
};

export const searchFlightByNumber = async (req, res) => {
  try {
    const { flightNumber } = req.param;

    // check cache
    const cachedFlight = await Flight.findOne({ flightNumber });

    if (cachedFlight) {
      return res.status(200).json({
        success: true,
        source: "cache",
        data: cachedFlight,
      });
    }

    //fetch API
    const apiResponse = await aviationStackService.getFlightByNumber(
      flightNumber
    );

    if (!apiResponse.data || apiResponse.data.length === 0) {
      returnres.status(404).json({
        success: false,
        message: "Flight not found",
      });
    }

    const flightData = apiResponse.data[0];
    const newFlight = new Flight({
      apiFlightId: flightData.flight.iata + "_" + flightData.flight_date,
      flightNumber: flightData.flight.iata,
      airline: flightData.airline.name,
      departureAirport: flightData.departure.airport,
      arrivalAirport: flightData.arrival.airport,
      departureTime: flightData.departure.scheduled,
      arrivalTime: flightData.arrival.scheduled,
      status: flightData.flight_status,
    });

    await newFlight.save();

    res.status(200).json({
        success: true,
        source: 'api',
        data: newFlight
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
