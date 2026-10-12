import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();

interface InitializePaymentResult {
    success: boolean;
    authorizationUrl: string;
    accessCode: string;
    reference: string;
}

interface VerifyPaymentResult {
    success: boolean;
    amount: number;
    reference: string;
    paidAt: string;
    channel: string;
    metadata: Record<string, any>;
}

interface RefundResult {
    success: boolean;
    refundId: string;
    status: string;
}

export const paystackService = {
    // Initialize payment
    async initializePayment(
        email: string,
        amount: number,
        bookingReference: string,
        metadata: Record<string, any> = {}
    ): Promise<InitializePaymentResult> {
        try {
            const response = await axios.post(
                "https://api.paystack.co/transaction/initialize",
                {
                    email,
                    amount: Math.round(amount * 100), // Convert to kobo/cents
                    reference: bookingReference,
                    callback_url: `${process.env.VITE_FRONTEND_URL}/payment/callback`,
                    metadata: {
                        bookingReference,
                        ...metadata,
                    },
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            return {
                success: true,
                authorizationUrl: response.data.data.authorization_url,
                accessCode: response.data.data.access_code,
                reference: response.data.data.reference,
            };
        } catch (error: any) {
            console.error("Paystack initialization error:", error.response?.data || error);
            throw new Error(
                error.response?.data?.message || "Failed to initialize payment"
            );
        }
    },

    // Verify payment
    async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
        try {
            const response = await axios.get(
                `https://api.paystack.co/transaction/verify/${reference}`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    },
                }
            );

            const data = response.data.data;

            return {
                success: data.status === "success",
                amount: data.amount / 100, // Convert from kobo/cents
                reference: data.reference,
                paidAt: data.paid_at,
                channel: data.channel,
                metadata: data.metadata,
            };
        } catch (error: any) {
            console.error("Paystack verification error:", error.response?.data || error);
            throw new Error(
                error.response?.data?.message || "Failed to verify payment"
            );
        }
    },

    // Process refund
    async processRefund(reference: string, amount: number): Promise<RefundResult> {
        try {
            const response = await axios.post(
                "https://api.paystack.co/refund",
                {
                    transaction: reference,
                    amount: Math.round(amount * 100), // Convert to kobo/cents
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            return {
                success: true,
                refundId: response.data.data.id,
                status: response.data.data.status,
            };
        } catch (error: any) {
            console.error("Paystack refund error:", error.response?.data || error);
            throw new Error(
                error.response?.data?.message || "Failed to process refund"
            );
        }
    },

    verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
        const secret = process.env.PAYSTACK_SECRET_KEY;

        if (!secret) {
            console.error("PAYSTACK_SECRET_KEY is not set; cannot verify webhook signatures");
            return false;
        }

        const expectedHash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");

        const expectedBuffer = Buffer.from(expectedHash, "utf-8");
        const providedBuffer = Buffer.from(signature, "utf-8");

        // timingSafeEqual throws on mismatched lengths rather than
        // returning false, so check that first — a length mismatch just
        // means "not a match," not a deeper error.
        if (expectedBuffer.length !== providedBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    },
};