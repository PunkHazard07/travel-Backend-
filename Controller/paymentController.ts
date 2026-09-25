import type { Request, Response } from "express";
import { bookingService } from "../Config/bookingService.js";
import { paystackService } from "../Config/paystackService.js";
import Booking from "../Model/booking.js";

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

        // Initialize Paystack payment
        const paymentData = await paystackService.initializePayment(
            userEmail,
            booking.totalPrice,
            booking.bookingReference,
            {
                bookingId: booking._id.toString(),
                bookingType: booking.bookingType,
                userId: userId.toString(),
            }
        );

        // Update booking with payment reference
        booking.paymentReference = paymentData.reference;
        booking.paymentMethod = "paystack";
        booking.paymentStatus = "processing";
        booking.authorizationUrl = paymentData.authorizationUrl;
        booking.accessCode = paymentData.accessCode;
        booking.paymentInitiatedAt = new Date();
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

// Shared idempotent "confirm booking as paid" step — called from both
// verifyPayment (client-initiated) and paystackWebhook (server-to-server)
// below. Whichever one reaches this first does the real work; the other
// sees paymentStatus already "paid" and returns without touching anything,
// so a Paystack webhook retry or a duplicate client verify call is always
// a safe no-op, not a second confirmation.
const confirmBookingPaid = async (
    booking: any,
    paymentData: { amount: number; paidAt: string; channel: string; reference: string }
): Promise<void> => {
    if (booking.paymentStatus === "paid") {
        return; 
    }

    const expectedKobo = Math.round(booking.totalPrice * 100);
    const paidKobo = Math.round(paymentData.amount * 100);

    if (expectedKobo !== paidKobo) {
        console.error(
            `Payment amount mismatch for booking ${booking._id}: expected ${booking.totalPrice}, Paystack confirmed ${paymentData.amount}`
        );
        booking.paymentStatus = "flagged";
        booking.paymentReference = paymentData.reference;
        booking.paymentMetadata = {
            paidAt: paymentData.paidAt,
            channel: paymentData.channel,
            amount: paymentData.amount,
            flaggedReason: "amount_mismatch",
        };
        await booking.save();
        return;
    }

    booking.paymentStatus = "paid";
    booking.paymentReference = paymentData.reference;
    booking.paymentMetadata = {
        paidAt: paymentData.paidAt,
        channel: paymentData.channel,
        amount: paymentData.amount,
    };

    // Confirm booking with provider (simulate)
    if (booking.status === "pending") {
        const providerResponse = await bookingService.simulateBookingProcess(booking);
        booking.status = providerResponse.status;
        booking.providerBookingId = providerResponse.providerBookingId;
    }

    await booking.save();
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

        await confirmBookingPaid(booking, paymentData);

        res.status(200).json({
            success: true,
            message: "Payment verified and booking confirmed",
            data: booking,
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

        // Deliberately don't trust the webhook payload's own amount/status
        // fields for the actual confirmation — re-verify server-to-server
        // against Paystack's API with our secret key, the same
        // authoritative call verifyPayment above makes. The webhook's real
        // job is "wake up and go check," not "tell us what happened."
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