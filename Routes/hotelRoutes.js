import express from 'express';
import { getHotels, searchHotels } from '../Controller/hotelController.js';

const router = express.Router();

//get hotels by country and city
router.get('/hotels', getHotels);

//get hotels with filters
router.get('/hotels/search', searchHotels);

export default router;