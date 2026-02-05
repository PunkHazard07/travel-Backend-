import axios from "axios";
import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();

export const paystackService = {
  // Initialize payment
  async initializePayment(email, amount, bookingReference, metadata = {}) {
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
    } catch (error) {
      console.error("Paystack initialization error:", error.response?.data || error);
      throw new Error(
        error.response?.data?.message || "Failed to initialize payment"
      );
    }
  },

  // Verify payment
  async verifyPayment(reference) {
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
    } catch (error) {
      console.error("Paystack verification error:", error.response?.data || error);
      throw new Error(
        error.response?.data?.message || "Failed to verify payment"
      );
    }
  },

  // Process refund
  async processRefund(reference, amount) {
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
    } catch (error) {
      console.error("Paystack refund error:", error.response?.data || error);
      throw new Error(
        error.response?.data?.message || "Failed to process refund"
      );
    }
  },
};