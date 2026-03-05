import express from 'express';
import {
    createFlightBooking,
    createHotelBooking,
    cancelBooking,
    initializePayment,
    verifyPayment
} from '../Controller/bookingController.js';
import { authenticate } from '../utils/authMiddleware.js';

const router = express.Router();

//create bookings
router.post('/flight', authenticate, createFlightBooking);
router.post('/hotel', authenticate, createHotelBooking);

//paymentroutes
router.post('/initialize', authenticate, initializePayment);
router.get('/verify', authenticate, verifyPayment);

//cancel bookings
router.put('/:bookingId/cancel', authenticate, cancelBooking);

//export the router
export default router;