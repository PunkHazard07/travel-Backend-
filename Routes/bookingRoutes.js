import express from 'express';
import {
    createFlightBooking,
    createHotelBooking,
    cancelBooking,
    getUserBookings,
} from '../Controller/bookingController.js';
import { authenticate } from '../utils/authMiddleware.js';

const router = express.Router();

//create bookings
router.post('/flight', authenticate, createFlightBooking);
router.post('/hotel', authenticate, createHotelBooking);

//get user bookings
router.get('/bookings', authenticate, getUserBookings);

//cancel bookings
router.put('/:bookingId/cancel', authenticate, cancelBooking);

export default router;