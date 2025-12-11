import express from 'express';
import {
    createFlightBooking,
    createHotelBooking,
    cancelBooking,
    confirmBooking,
    initializePayment,
    verifyPayment
} from '../Controller/bookingController.js';
import { authenticate } from '../utils/authMiddleware.js';

const router = express.Router();

//create bookings
router.post('/flight', authenticate, createFlightBooking);
router.post('/hotel', authenticate, createHotelBooking);

//paymentroutes
router.post('/intialize', authenticate, initializePayment);
router.get('/verify', authenticate, verifyPayment);
//confirm bookings
router.post('/confirm', authenticate, confirmBooking);

//cancel bookings
router.put('/:bookingId/cancel', authenticate, cancelBooking);

//export the router
export default router;