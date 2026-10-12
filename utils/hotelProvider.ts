import type { BookingDocument } from "../Model/booking.js";
import { prebookRate, bookRate, LiteApiError } from "../Config/liteBooking.js";
import { BookingError } from "./bookingError.js";
import { SETTLEMENT_CURRENCY, PrebookPriceError, computePrebookPrice, buildBookRequest, mapBookResponse, type PrebookPrice } from "./hotelBooking.js";

export type ProviderOutcome = | { outcome: "confirmed"; providerBookingId: string; providerData?: Record<string, any> } | { outcome: "failed"; reason: string } | { outcome: "unknown"; reason: string };

export const prebookMaxAgeMs = (): number => { const minutes = Number(process.env.PREBOOK_MAX_AGE_MINUTES);
    return (Number.isFinite(minutes) && minutes > 0 ? minutes : 10) * 60_000;
};

export const litePaymentMethod = (): string => process.env.LITE_PAYMENT_METHOD || "ACC_CREDIT_CARD";

const short = (text: string): string => text.slice(0, 200);

export const prebookOrThrow = async (offerId: string): Promise<{ prebookId: string; price: PrebookPrice }> => {
    let data: any;
    try {
        data = await prebookRate(offerId);
    } catch (error) {
        if (error instanceof LiteApiError) {
            console.error("LiteAPI prebook failed:", error.message);
            // 408 is how LiteAPI reports an outdated offer.
            if (error.kind === "rejected" || error.status === 408) {
                throw new BookingError(409, "OFFER_UNAVAILABLE", "This room rate is no longer available. Please search again.");
            }
            throw new BookingError(503, "PROVIDER_UNAVAILABLE", "The hotel provider is temporarily unavailable. Please try again shortly.");
        }
        throw error;
    }

    const prebookId = data?.prebookId != null ? String(data.prebookId) : "";
    if (!prebookId) {
        console.error("LiteAPI prebook response had no prebookId");
        throw new BookingError(502, "PROVIDER_BAD_RESPONSE", "The hotel provider returned an unexpected response.");
    }

    let price: PrebookPrice;
    try {
        price = computePrebookPrice(data, SETTLEMENT_CURRENCY);
    } catch (error) {
        if (error instanceof PrebookPriceError) {
            console.error("Could not read price from prebook response:", error.message);
            throw new BookingError(502, "PROVIDER_BAD_RESPONSE", "Could not determine the price for this rate.");
        }
        throw error;
    }

    if (price.basis === "retailRate" && price.reportedPrice !== null && Math.abs(price.reportedPrice - price.total) > 1) {
        console.warn(
            `Prebook price basis differs: retailRate-derived ${price.total} vs reported price ${price.reportedPrice} (${prebookId})`
        );
    }

    return { prebookId, price };
};

// Books a paid hotel booking with LiteAPI and classifies the result.
export const bookHotel = async (booking: BookingDocument): Promise<ProviderOutcome> => {
    const hotelData: Record<string, any> = booking.hotelData ?? {};

    if (!booking.prebookId || !hotelData.holder) {
        return { outcome: "failed", reason: "missing_prebook_or_holder" };
    }

    try {
        const data = await bookRate(
            buildBookRequest({
                prebookId: booking.prebookId,
                holder: hotelData.holder,
                guests: hotelData.guests ?? [],
                clientReference: booking.bookingReference,
                paymentMethod: litePaymentMethod(),
            })
        );

        const mapped = mapBookResponse(data);

        if (mapped.confirmed && mapped.providerBookingId) {
            return {
                outcome: "confirmed",
                providerBookingId: mapped.providerBookingId,
                providerData: {
                    status: mapped.status,
                    hotelConfirmationCode: mapped.confirmationCode,
                    supplierBookingId: mapped.supplierBookingId,
                },
            };
        }

        // Answered 200 but not CONFIRMED (e.g. pending): the reservation may
        // exist, so this is not a clean failure.
        return { outcome: "unknown", reason: short(`provider_status_${mapped.status ?? "missing"}`) };
    } catch (error: any) {
        if (error instanceof LiteApiError) {
            console.error(`LiteAPI book failed for ${booking.bookingReference}:`, error.message);
            return error.kind === "rejected"
                ? { outcome: "failed", reason: short(`provider_rejected: ${error.message}`) }
                : { outcome: "unknown", reason: short(`provider_unreachable: ${error.message}`) };
        }
        console.error(`Unexpected error booking ${booking.bookingReference}:`, error);
        return { outcome: "unknown", reason: "unexpected_error" };
    }
};