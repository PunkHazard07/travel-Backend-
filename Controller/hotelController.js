import { fetchHotelsFromAPI } from "../Config/hotel.js";
import { getCountryCode } from "../utils/countryCodeMapper.js";
import Hotel from '../Model/hotel.js';

export const getHotels = async (req, res) => {
    try {
        const { country, cityName, limit = 20 } = req.query;
        
        if (!country || !cityName) {
            return res.status(400).json({
                success: false,
                message: 'Country and cityName are required'
            });
        }

        //convert country name to code
        const countryCode = getCountryCode(country);

        if (!countryCode) {
             return res.status(400).json({
                success: false,
                message: 'Invalid country name or code. Please provide a valid country.'
             });
        }


        // cache 
        const cachedHotels = await Hotel.find({
            'location.country': countryCode,
            'location.city': cityName,
             cachedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } // 6 hours
        }).limit(parseInt(limit)); 

        if (cachedHotels.length > 0) {
            return res.status(200).json({
                success: true,
                source: 'cache',
                count: cachedHotels.length,
                data: cachedHotels
            });
        }

        //fetch from API
        const apiResponse = await fetchHotelsFromAPI(countryCode, cityName, limit);

        if (!apiResponse || !apiResponse.data || !Array.isArray(apiResponse.data)) {
            return res.status(500).json({
                success: false,
                message: 'Failed to fetch hotels from API',
                error: apiResponse || 'No response from API'
            })
        }

        //save to the database
        const savedHotels = await Promise.all(
            apiResponse.data.slice(0, limit).map(async (hotel) => {
                return await Hotel.findOneAndUpdate(
                    { apiHotelId: hotel.id},
                    {
                        apiHotelId: hotel.id,
                        name: hotel.name,
                        location: {
                            city: cityName,
                            country: countryCode,
                        },
                        rating: hotel.rating || 0,
                        pricePerNight: hotel.price || hotel.pricePerNight,
                        image: hotel.image || hotel.images?.[0] || '',
                        description: hotel.description || hotel.hotelDescription,
                        cachedAt: new Date(),
                    },
                    {upsert: true, new: true}
                );
            })
        );

        res.status(200).json({
            success: true,
            source: 'api',
            count: savedHotels.length,
            data: savedHotels
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};



export const searchHotels = async (req, res) => {
    try {
        const query = {};

        if (req.query.city) {
            query['location.city'] = new RegExp(req.query.city, 'i');
        }
        if (req.query.country) {
            const countryCode = getCountryCode(req.query.country);

            if (!countryCode) {
                return res.status(400).json({
                    success: false,
                    message: 'invalid country name or code. Please provide a valid country.'
                });
            }
            query['location.country'] = countryCode;
        }
        if (req.query.minRating) {
            query.rating = {$gte: parseFloat(req.query.minRating) };
        }
        if (req.query.maxPrice) {
            query.pricePerNight = {$lte: parseFloat(req.query.maxPrice) };
        }
        
        const hotels = await Hotel.find(query);

        res.status(200).json({
            success: true,
            count: hotels.length,
            data: hotels
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};