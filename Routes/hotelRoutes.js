import express from "express"
import { getHotels, advancedHotelSearch, getHotelRates } from '../Controller/hotelController.js';

const router = express.Router();

//get hotels by country and city
router.get('/hotels', getHotels);

router.get("/hotels/advanced-search", advancedHotelSearch);

// bookable rooms/rates (with offerIds) for one hotel
router.get("/hotels/:hotelId/rates", getHotelRates);

export default router; 