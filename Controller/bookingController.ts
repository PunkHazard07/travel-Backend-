import type { Request, Response } from "express";
import DuffelService from "../Config/duffel.js";
import { bookingService, BookingError } from "../Config/bookingService.js";
import { mapDuffelFlightOffer } from "../utils/mapper.js";
import { validateHotelBookingInput } from "../utils/hotelBooking.js";
import { FlightPriceError } from "../utils/flightPricing.js";
import { fetchFlightQuote, FlightQuoteError } from "../utils/flightQuote.js";

let duffelService: any = null;
const getDuffel = (): any => {
    if (!duffelService) duffelService = new DuffelService();
    return duffelService;
};

const sendError = (res: Response, error: unknown, context: string, fallbackMessage: string) => {
    if (error instanceof BookingError) {
        return res.status(error.statusCode).json({
            success: false,
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
        });
    }

    console.error(`${context}:`, error);
    return res.status(500).json({ success: false, message: fallbackMessage });
};

// Create flight booking. The amount is derived from Duffel's own offer data;
// whatever price the client sends is ignored.
export const createFlightBooking = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const { flightOffer, passengers, selectedServices, totalPrice } = req.body ?? {};

        if (!flightOffer || typeof flightOffer.offerId !== "string" || !flightOffer.offerId) {
            return res.status(400).json({ success: false, message: "flightOffer.offerId is required" });
        }

        if (!Array.isArray(passengers) || passengers.length === 0 || passengers.length > 9) {
            return res.status(400).json({ success: false, message: "Passengers must be a list of 1 to 9 people" });
        }

        if (selectedServices !== undefined && !Array.isArray(selectedServices)) {
            return res.status(400).json({ success: false, message: "selectedServices must be a list" });
        }

        if (selectedServices !== undefined && !Array.isArray(selectedServices)) {
            return res.status(400).json({ success: false, message: "selectedServices must be a list" });
        }
        
        const selected = (selectedServices ?? []).map((s: any) => ({ id: s?.id, quantity: s?.quantity }));

        let quote;
        try {
            quote = await fetchFlightQuote(getDuffel(), flightOffer.offerId, selected);
        } catch (error) {
            if (error instanceof FlightQuoteError) {
                switch (error.code) {
                    case "provider_not_configured":
                        return res.status(503).json({ success: false, message: error.message });
                    case "offer_unavailable":
                        return res.status(409).json({ success: false, code: "OFFER_UNAVAILABLE", message: error.message });
                    case "offer_expired":
                        return res.status(409).json({ success: false, code: "OFFER_EXPIRED", message: error.message });
                    default:
                        return res.status(502).json({ success: false, message: error.message });
                }
            }
            if (error instanceof FlightPriceError) {
                const status = error.code === "offer_price_invalid" ? 502 : 400;
                return res.status(status).json({ success: false, code: error.code, message: error.message });
            }
            throw error;
        }

        const { offer, total } = quote;

        if (totalPrice !== undefined && Math.abs(Number(totalPrice) - total.total) > Math.max(1, total.total * 0.01)) {
            console.warn(
                `Client-supplied flight total ${totalPrice} differs from Duffel total ${total.total} ${total.currency} (offer ${flightOffer.offerId}); using Duffel's.`
            );
        }

        const mapped = mapDuffelFlightOffer(offer);

        const booking = await bookingService.createFlightBooking(
            userId,
            {
                offerId: offer.id,
                source: "duffel",
                validatingAirlineCodes: mapped.validatingAirlineCodes,
                itineraries: mapped.itineraries,
                price: {
                    currency: total.currency,
                    total: total.offerTotal,
                    base: Number.parseFloat(offer.base_amount) || total.offerTotal,
                },
                selectedServices: (selectedServices ?? []).map((s: any) => ({
                    id: s?.id,
                    quantity: s?.quantity,
                    designator: s?.designator,
                    passengerId: s?.passengerId,
                })),
                passengers,
            },
            total.total
        );

        res.status(201).json({
            success: true,
            message: "Flight booking created successfully",
            data: booking,
            priceBreakdown: {
                currency: total.currency,
                offerTotal: total.offerTotal,
                servicesTotal: total.servicesTotal,
                total: total.total,
            },
        });
    } catch (error) {
        sendError(res, error, "Create Flight Booking Error", "Failed to create flight booking");
    }
};

// Create hotel booking. The client says WHICH rate it wants (offerId, from
// GET /hotels/:hotelId/rates); the price comes from LiteAPI's prebook.
export const createHotelBooking = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;

        const validation = validateHotelBookingInput(req.body);
        if (validation.ok === false) {
            return res.status(400).json({ success: false, message: validation.message });
        }

        const booking = await bookingService.createHotelBooking(userId, validation.value);

        res.status(201).json({
            success: true,
            message: "Hotel booking created successfully",
            data: booking,
        });
    } catch (error) {
        sendError(res, error, "Create Hotel Booking Error", "Failed to create hotel booking");
    }
};

// Get user bookings
export const getUserBookings = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.id;
        const { bookingType, status } = req.query as { bookingType?: string; status?: string };

        const bookings = await bookingService.getUserBookings(userId, { bookingType, status });

        res.status(200).json({
            success: true,
            data: bookings,
        });
    } catch (error) {
        sendError(res, error, "Get User Bookings Error", "Failed to fetch user bookings");
    }
};

// Cancel booking
export const cancelBooking = async (req: Request, res: Response) => {
    try {
        const { bookingId } = req.params as { bookingId?: string };
        const userId = (req as any).user?.id;
        const { reason } = req.body ?? {};

        if (!bookingId) {
            return res.status(400).json({ success: false, message: "Booking ID is required" });
        }

        const booking = await bookingService.cancelBooking(bookingId, userId);

        res.status(200).json({
            success: true,
            message: "Booking cancelled successfully",
            data: {
                booking,
                cancellationReason: reason || "User requested cancellation",
            },
        });
    } catch (error) {
        sendError(res, error, "Cancel Booking Error", "Failed to cancel booking");
    }
};