import express from "express"
import { getHotels, advancedHotelSearch } from '../Controller/hotelController.js';

const router = express.Router();

//get hotels by country and city
router.get('/hotels', getHotels);

router.get("/hotels/advanced-search", advancedHotelSearch);

export default router;