import type { Request, Response } from "express";
import { bookingService } from "../Config/bookingService.js";
import { paystackService } from "../Config/paystackService.js";
import { convertForCheckout } from "../utils/currencyConverter.js";
import Booking, { type BookingDocument, type PaymentStatus} from "../Model/booking.js";

const SETTLEMENT_CURRENCY = "NGN";

//the amount paystack is asked to charge in NGN 
const getExpectedChargeAmount = (booking: BookingDocument): number =>
    booking.currencyConversion?.convertedAmount ?? booking.totalPrice;

// Initialize payment for booking
export const initializePayment = async (req: Request, res: Response) => {
    try {
        const { bookingId } = req.body;
        const userId = (req as any).user?.id || (req as any).userId;
        const userEmail = (req as any).user?.email || req.body.email;

        if (!bookingId) {
            return res.status(400).json({
                success: false,
                message: "Booking ID is required",
            });
        }

        if (!userEmail) {
            return res.status(400).json({
                success: false,
                message: "Email is required for payment",
            });
        }

        // Find booking
        const booking = await Booking.findOne({ _id: bookingId, userId });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        // Check if already paid
        if (booking.paymentStatus === "paid") {
            return res.status(400).json({
                success: false,
                message: "Booking has already been paid for",
            });
        }

        // Check if booking is cancelled
        if (booking.status === "cancelled") {
            return res.status(400).json({
                success: false,
                message: "Cannot pay for a cancelled booking",
            });
        }

        // Idempotency guard: don't mint a second, independent Paystack
        // transaction for a booking that already has one in flight —
        // Paystack's `reference` has to be unique per transaction, so
        // retrying this endpoint must never generate a new one while the
        // first attempt is still live. Hand back exactly what was already
        // generated instead.
        if (booking.paymentStatus === "processing" && booking.paymentReference && booking.authorizationUrl) {
            return res.status(200).json({
                success: true,
                message: "Payment already initialized for this booking",
                data: {
                    authorizationUrl: booking.authorizationUrl,
                    reference: booking.paymentReference,
                    accessCode: booking.accessCode,
                },
            });
        }

        //conversion to NGN and what paystack should actually charge
        //fresh price from FX api
        let chargeAmount = booking.totalPrice;
        let currencyConversion: {
            from: string;
            to: string;
            originalAmount: number;
            convertedAmount: number;
        } | null = null;

        if (booking.bookingType === "flight") {
            const sourceCurrency = booking.flightData?.price?.currency;

            if (sourceCurrency && sourceCurrency.toUpperCase() !== SETTLEMENT_CURRENCY) {
                try {
                    chargeAmount = await convertForCheckout(
                        booking.totalPrice,
                        sourceCurrency,
                        SETTLEMENT_CURRENCY
                    );
                } catch (conversionError) {
                    console.error("Currency conversion error:", conversionError);
                    return res.status(503).json({
                        success: false,
                        message: "Unable to fetch a current exchange rate. Please try again shortly.",
                    });
                }

                currencyConversion = {
                    from: sourceCurrency.toUpperCase(),
                    to: SETTLEMENT_CURRENCY,
                    originalAmount: booking.totalPrice,
                    convertedAmount: chargeAmount,
                };
            }
        }

        // Initialize Paystack payment
        const paymentData = await paystackService.initializePayment(
            userEmail,
            chargeAmount,
            booking.bookingReference,
            {
                bookingId: booking._id.toString(),
                bookingType: booking.bookingType,
                userId: userId.toString(),
                ...(currencyConversion ? { currencyConversion } : {}),
            }
        );

        // Update booking with payment reference
        booking.paymentReference = paymentData.reference;
        booking.paymentMethod = "paystack";
        booking.paymentStatus = "processing";
        booking.authorizationUrl = paymentData.authorizationUrl;
        booking.accessCode = paymentData.accessCode;
        booking.paymentInitiatedAt = new Date();
        booking.set("currencyConversion", currencyConversion ?? undefined); //persist the locked-in conversion
        await booking.save();

        res.status(200).json({
            success: true,
            message: "Payment initialized successfully",
            data: {
                authorizationUrl: paymentData.authorizationUrl,
                reference: paymentData.reference,
                accessCode: paymentData.accessCode,
            },
        });
    } catch (error: any) {
        console.error("Initialize Payment Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to initialize payment",
        });
    }
};

type PaymentData = { amount: number; paidAt: string; channel: string; reference: string };

const OPEN_PAYMENT_STATES: PaymentStatus[] = ["unpaid", "processing"];

//moves a booking to flagged to check if the money needs to be refunded or manual sent back
const flagBooking = async ( bookingId: any, reason: string, paymentData: PaymentData): Promise<BookingDocument | null> => {
    return Booking.findOneAndUpdate(
        { _id: bookingId, paymentStatus: { $in: OPEN_PAYMENT_STATES } },
        {
            $set: {
                paymentStatus: "flagged",
                paymentReference: paymentData.reference,
                paymentMetadata: {
                    paidAt: paymentData.paidAt,
                    channel: paymentData.channel,
                    amount: paymentData.amount,
                    flaggedReason: reason,
                },
            },
        },
        { new: true }
    );
};

//shared idempotent to confirm booking as a step called from both verifyPayment and paystackwebhook
const confirmBookingPaid = async ( booking: BookingDocument, paymentData: PaymentData): Promise<BookingDocument> => {
    const latest = async (): Promise<BookingDocument> =>
        (await Booking.findById(booking._id)) ?? booking;

    if (!OPEN_PAYMENT_STATES.includes(booking.paymentStatus)) {
        return booking;
    }

    //customer was charged for a booking that's been cancelled don't resurrect it and don't swallow the money either
    if (booking.status === "cancelled") {
        console.error(`Payment received for cancelled booking ${booking._id} (ref ${paymentData.reference})`);
        return (await flagBooking(booking._id, "paid_after_cancel", paymentData)) ?? (await latest());
    }

    const expectedAmount = getExpectedChargeAmount(booking);
    const expectedKobo = Math.round(expectedAmount * 100);
    const paidKobo = Math.round(paymentData.amount * 100);

    if (expectedKobo !== paidKobo) {
        console.error(
            `Payment amount mismatch for booking ${booking._id}: expected ${expectedAmount} ${SETTLEMENT_CURRENCY}, Paystack confirmed ${paymentData.amount}`
        );
        return (await flagBooking(booking._id, "amount_mismatch", paymentData)) ?? (await latest());
    }

    //Atomic claim. Only one concurrent caller gets a document back
    const claimed = await Booking.findOneAndUpdate(
        {
            _id: booking._id,
            paymentStatus: { $in: OPEN_PAYMENT_STATES },
            status: { $ne: "cancelled" },
        },
        {
            $set: {
                paymentStatus: "paid",
                paymentReference: paymentData.reference,
                paymentMetadata: {
                    paidAt: paymentData.paidAt,
                    channel: paymentData.channel,
                    amount: paymentData.amount,
                },
            },
        },
        { new: true}
    );
    
    if (!claimed) {
        const current = await latest();
        if (OPEN_PAYMENT_STATES.includes(current.paymentStatus) && current.status === "cancelled") {
            return (await flagBooking(current._id, "paid_after_cancel", paymentData)) ?? (await latest());
        }
        return current;
    }

      // We won the claim: we're the only caller who runs the provider step.
    if (claimed.status !== "pending") {
        return claimed;
    }

    const flagProviderFailure = (reason: string) => {
        claimed.status = "failed";
        claimed.paymentStatus = "flagged";
        claimed.paymentMetadata = {
            ...(claimed.paymentMetadata ?? {}),
            flaggedReason: reason,
        };
    };

    try {
        const providerResponse = await bookingService.simulateBookingProcess(claimed);
        claimed.providerBookingId = providerResponse.providerBookingId;

        if (providerResponse.status === "confirmed") {
            claimed.status = "confirmed";
        } else {
            // Customer is charged but nothing was secured with the provider.
            console.error(`Provider step failed after payment for booking ${claimed._id}`);
            flagProviderFailure("provider_failed_after_payment");
        }
    } catch (error: any) {
        console.error(`Provider step threw after payment for booking ${claimed._id}:`, error);
        flagProviderFailure("provider_error_after_payment");
    }

    await claimed.save();
    return claimed;
};

// Verify payment and confirm booking
export const verifyPayment = async (req: Request, res: Response) => {
    try {
        const { reference } = req.query as { reference?: string };

        if (!reference) {
            return res.status(400).json({
                success: false,
                message: "Payment reference is required",
            });
        }

        // Verify payment with Paystack
        const paymentData = await paystackService.verifyPayment(reference);

        if (!paymentData.success) {
            return res.status(400).json({
                success: false,
                message: "Payment verification failed",
            });
        }

        // Find booking by reference
        const booking = await Booking.findOne({
            paymentReference: reference,
        });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        const settled = await confirmBookingPaid(booking, paymentData);

        // Money was taken but the booking couldn't be confirmed (wrong
        // amount, cancelled, or provider failure).
        if (settled.paymentStatus === "flagged") {
            return res.status(409).json({
                success: false,
                message: 
                "Your payment was received but the booking needs manual review. Please contact support and quote your booking reference.",
                data: settled
            })
        }

        res.status(200).json({
            success: true,
            message: "Payment verified and booking confirmed",
            data: settled,
        });
    } catch (error: any) {
        console.error("Verify Payment Error:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to verify payment",
        });
    }
};

// Paystack webhook — server-to-server notification, no user JWT, no
// `authenticate` middleware (see Routes/paymentRoutes.js). Authenticates
// itself via the x-paystack-signature header instead.
export const paystackWebhook = async (req: Request, res: Response) => {
    try {
        const signature = req.headers["x-paystack-signature"] as string | undefined;
        const rawBody = (req as any).rawBody as Buffer | undefined;

        if (!signature || !rawBody) {
            return res.status(400).json({ success: false, message: "Missing signature or raw body" });
        }

        if (!paystackService.verifyWebhookSignature(rawBody, signature)) {
            console.warn("Paystack webhook signature verification failed");
            return res.status(400).json({ success: false, message: "Invalid signature" });
        }

        const event = req.body;

        if (event?.event !== "charge.success") {
            return res.status(200).json({ success: true, message: "Event ignored" });
        }

        const reference = event.data?.reference;

        if (!reference) {
            return res.status(200).json({ success: true, message: "No reference in payload, ignored" });
        }

        const booking = await Booking.findOne({ paymentReference: reference });

        if (!booking) {
            console.warn(`Webhook received for unknown booking reference: ${reference}`);
            return res.status(200).json({ success: true, message: "No matching booking" });
        }

        const paymentData = await paystackService.verifyPayment(reference);

        if (!paymentData.success) {
            return res.status(200).json({ success: true, message: "Re-verification did not confirm success" });
        }

        await confirmBookingPaid(booking, paymentData);

        res.status(200).json({ success: true, message: "Webhook processed" });
    } catch (error: any) {
        console.error("Paystack Webhook Error:", error);
        res.status(500).json({ success: false, message: "Webhook processing failed" });
    }
};