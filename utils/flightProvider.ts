import type { BookingDocument } from "../Model/booking.js";
import DuffelService from "../Config/duffel.js";
import { BookingError } from "./bookingError.js";
import { type ProviderOutcome } from "./hotelProvider.js";

const duffel = new DuffelService();

/**
 * Books a flight booking with Duffel and classifies the result.
 * Matches the "confirmed, failed, unknown" pattern from hotelProvider.ts.
 */
export const bookFlight = async (booking: BookingDocument): Promise<ProviderOutcome> => {
    const flightData = booking.flightData;

    if (!flightData || !flightData.offerId) {
        return { outcome: "failed", reason: "missing_flight_data_or_offer_id" };
    }

    if (!flightData.passengers || !Array.isArray(flightData.passengers) || flightData.passengers.length === 0) {
        return { outcome: "failed", reason: "missing_passengers" };
    }

    try {
        // Prepare order request for Duffel
        // Based on Duffel API: orders.create expects offer_id and passengers
        const orderParams = {
            offer_id: flightData.offerId,
            passengers: flightData.passengers.map((p: any) => ({
                first_name: p.firstName,
                last_name: p.lastName,
                email: p.email,
                date_of_birth: p.dateOfBirth,
                gender: p.gender,
                passport_number: p.passportNumber,
                passport_expiry_date: p.passportExpiryDate,
                passport_issuing_country: p.passportIssuingCountry,
                nationality: p.nationality,
                phone_number: p.phoneNumber,
            })),
            // Include selected services if any
            services: (flightData.selectedServices || []).map((s: any) => ({
                id: s.id,
                quantity: s.quantity,
            })),
        };

        const result = await duffel.createOrder(orderParams);

        if (!result.success) {
            const error = result.error;
            console.error(`Duffel order creation failed for booking ${booking._id}:`, error);

            // If the API explicitly rejected the order (e.g. 422, 400) it's a failure.
            // If it's a 5xx or network error, it's unknown.
            if (error?.status >= 400 && error?.status < 500) {
                return { outcome: "failed", reason: `provider_rejected: ${error.message}` };
            }
            return { outcome: "unknown", reason: `provider_error: ${error?.message || "unexpected"}` };
        }

        const order = result.data;

        // Duffel orders typically have a status.
        // 'confirmed' or 'issued' usually means success.
        if (order.status === "confirmed" || order.status === "issued") {
            return {
                outcome: "confirmed",
                providerBookingId: order.id,
                providerData: {
                    status: order.status,
                    order_id: order.id,
                },
            };
        }

        // If the order is created but in a 'pending' or other state, it's unknown.
        return { outcome: "unknown", reason: `provider_status_${order.status || "missing"}` };

    } catch (error: any) {
        console.error(`Unexpected error booking flight ${booking._id}:`, error);
        return { outcome: "unknown", reason: "unexpected_error" };
    }
};
