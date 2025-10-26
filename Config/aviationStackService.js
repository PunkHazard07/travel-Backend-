import axios from 'axios';
import dotenv from 'dotenv';
//load dotenv
dotenv.config();

class AviationStackService {
  constructor() {
    this.baseURL = 'https://api.aviationstack.com/v1';
    this.accessKey = process.env.AVIATIONSTACK_KEY;
    
    if (!this.accessKey) {
      throw new Error('AVIATIONSTACK_KEY is not defined in environment variables');
    }
  }

  async getFlights(params = {}) {
    try {
      const response = await axios.get(`${this.baseURL}/flights`, {
        params: {
          access_key: this.accessKey,
          ...params
        }
      });
      return response.data;
    } catch (error) {
      console.error('AviationStack API Error:', error.response?.data || error.message);
      throw new Error(error.response?.data?.error?.message || 'Failed to fetch flights');
    }
  }

  async getFlightByNumber(flightIata) {
    return this.getFlights({ flight_iata: flightIata });
  }

  async getFlightsByAirline(airlineIata) {
    return this.getFlights({ airline_iata: airlineIata });
  }

  async getFlightsByRoute(depIata, arrIata) {
    return this.getFlights({ 
      dep_iata: depIata,
      arr_iata: arrIata 
    });
  }
}

export default new AviationStackService();