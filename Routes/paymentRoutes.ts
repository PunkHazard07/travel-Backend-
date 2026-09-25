import express from "express";
import { initializePayment, verifyPayment, paystackWebhook } from "../Controller/paymentController.js";
import { authenticate } from "../utils/authMiddleware.js";

const router = express.Router();

router.post("/initialize", authenticate, initializePayment);
router.get("/verify", authenticate, verifyPayment);
router.post("/webhook/paystack", paystackWebhook);

export default router;