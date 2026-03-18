import { fetchHotelsFromAPI } from "../Config/hotel.js";
import { getCountryCode } from "../utils/countryCodeMapper.js";
import estimatedPrice from "../utils/estimatedPrice.js";
import Hotel from "../Model/hotel.js";

export const getHotels = async (req, res) => {
  try {
    const { country, cityName, limit = 60 } = req.query;

    if (!country || !cityName) {
      return res.status(400).json({
        success: false,
        message: "Country and cityName are required",
      });
    }

    //convert country name to code
    const countryCode = getCountryCode(country);

    if (!countryCode) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid country name or code. Please provide a valid country.",
      });
    }

    // cache
    const cachedHotels = await Hotel.find({
      "location.country": countryCode,
      "location.city": { $regex: new RegExp(cityName, "i") },
      cachedAt: { $gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }, // 6 hours
    })
    .sort({ rating: -1, pricePerNight: 1 })
    .limit(parseInt(limit));

    if (cachedHotels.length > 0) {
      return res.status(200).json({
        success: true,
        source: "cache",
        count: cachedHotels.length,
        data: cachedHotels,
      });
    }

    //fetch from API
    const apiResponse = await fetchHotelsFromAPI(countryCode, cityName, 100);

    if (!apiResponse || !apiResponse.data || !Array.isArray(apiResponse.data)) {
      return res.status(500).json({
        success: false,
        message: "Failed to fetch hotels from API",
        error: apiResponse || "No response from API",
      });
    }

    //save to the database - based on schema fields
    const savedHotels = await Promise.all(
      apiResponse.data.map(async (hotel) => {
        
        // use estimated price
        const price = estimatedPrice({
          stars: hotel.stars || Math.floor(Math.random() * 3) + 2,
          rating: hotel.rating || (Math.random() * 2 + 6),
          currency: hotel.currency || "NGN",
        });

        const hotelData = {
          apiHotelId: hotel.id,
          name: hotel.name,
          location: {
            city: hotel.city || cityName,
            country: hotel.country || countryCode,
          },
          rating: hotel.rating || (Math.random() * 2 + 6),
          stars: hotel.stars || Math.floor(Math.random() * 3) + 2,
          pricePerNight: price,
          currency: hotel.currency || "NGN",
          main_photo: hotel.main_photo || "",
          thumbnail: hotel.thumbnail || "",
          hotelDescription: hotel.hotelDescription || "",
          cachedAt: new Date(),
        };

        return await Hotel.findOneAndUpdate(
          { apiHotelId: hotel.id },
          hotelData,
          { upsert: true, new: true }
        );
      })
    );

    console.log(`Successfully saved ${savedHotels.length} hotels to database`);
    
    // Now limit the response, not the save
    const limitedResults = savedHotels
      .sort((a, b) => b.rating - a.rating || a.pricePerNight - b.pricePerNight)
      .slice(0, parseInt(limit));

      res.status(200).json({
      success: true,
      source: "api",
      count: limitedResults.length,
      totalAvailable: savedHotels.length,
      data: limitedResults,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



export const advancedHotelSearch = async (req, res) => {
  try {
    const {
      city,
      country,
      minRating = 0,
      maxPrice = 10000,
      sortBy = "recommended",
      limit = 60,
      page = 1,
    } = req.query;

    // Build query for MongoDB
    const query = {};

    if (city) {
      query["location.city"] = new RegExp(city, "i");
    }

    if (country) {
      const countryCode = getCountryCode(country);
      if (countryCode) {
        query["location.country"] = countryCode;
      }
    }

    if (minRating && parseFloat(minRating) > 0) {
      query.rating = { $gte: parseFloat(minRating) };
    }

    if (maxPrice && parseFloat(maxPrice) < 10000) {
      query.pricePerNight = { $lte: parseFloat(maxPrice) };
    }

    // Sorting logic
    let sortOptions = {};
    switch (sortBy) {
      case "price-low":
        sortOptions = { pricePerNight: 1, rating: -1 };
        break;
      case "price-high":
        sortOptions = { pricePerNight: -1, rating: -1 };
        break;
      case "rating":
        sortOptions = { rating: -1, pricePerNight: 1 };
        break;
      default:
        sortOptions = { rating: -1, pricePerNight: 1 };
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const hotels = await Hotel.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const totalCount = await Hotel.countDocuments(query);

    res.status(200).json({
      success: true,
      count: hotels.length,
      totalCount,
      page: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      filters: {city, country, minRating, maxPrice, sortBy },
      data: hotels,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};