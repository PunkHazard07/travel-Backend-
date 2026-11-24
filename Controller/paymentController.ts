import type { Request, Response } from "express";
import { bookingService, BookingError } from "../Config/bookingService.js";
import { paystackService } from "../Config/paystackService.js";
import { paymentAttemptService } from "../Config/paymentAttemptService.js";
import { SETTLEMENT_CURRENCY, settleAttemptPayment, toOutcomeInput, type VerifiedPayment } from "../Config/paymentSettlement.js";
import { convertForCheckout } from "../utils/currencyConverter.js";
import Booking, { type BookingDocument} from "../Model/booking.js";
import type { PaymentAttemptDocument } from "../Model/paymentAttempt.js";
import { checkPaymentEligibility } from "../utils/paymentEligibility.js";
import { decideAttemptRetry } from "../utils/paymentAttemptEligibility.js";
import { isAmbiguousPaystackError } from "../utils/paystackErrors.js";
import { supplierCurrency, totalsMatch } from "../utils/supplierPrice.js";
// import { isPendingAttemptExpired } from "../utils/paymentAttemptPolicy.js";

const supersedeAttempt = async (attempt: PaymentAttemptDocument | null, reason: string): Promise<void> => {
    if (attempt) await paymentAttemptService.expire(attempt._id, reason);
};

// Re-checks the supplier's CURRENT price (LiteAPI prebook for hotels, Duffel offer for flights)
// before any payment starts or resumes. Returns true if a response was sent and the caller must stop:
//  - supplier says the offer is gone/expired, or can't be reached: payment is blocked;
//  - the price moved (up OR down): the customer must confirm the new total;
//  - the customer confirmed a total (expectedTotal) that isn't the current one: asked again.
// `openAttempt` is the customer's existing pending attempt, if any. It is closed whenever the offer
// or price it was created for is no longer valid.
const rejectIfPriceNotConfirmed = async (
    booking: BookingDocument,
    expectedTotal: number | undefined,
    openAttempt: PaymentAttemptDocument | null,
    res: Response
): Promise<boolean> => {
    let result: Awaited<ReturnType<typeof bookingService.revalidateForPayment>>;

    try {
        result = await bookingService.revalidateForPayment(booking);
    } catch (error) {
        if (error instanceof BookingError) {
            if (error.statusCode === 409) {
                await supersedeAttempt(openAttempt, `superseded_${error.code.toLowerCase()}`);
            }
            res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
            return true;
        }
        throw error;
    }

    const currency = result.currency ?? supplierCurrency(booking);

    if (result.priceChanged) {
        await supersedeAttempt(openAttempt, "superseded_price_changed");
        res.status(409).json({
            success: false,
            code: "PRICE_CHANGED",
            message: "The price for this booking has changed. Please review the new total.",
            details: {
                previousTotal: result.previousTotal,
                newTotal: result.newTotal,
                currency,
                ...(result.previousCurrency ? { previousCurrency: result.previousCurrency } : {})
            }
        });
        return true;
    }

    // The price didn't change since we last stored it, but it may not be what the customer
    // agreed to (they confirmed an older total, e.g. from another tab). The existing attempt, if
    // any, is still correct for the current total, so it is left open.

    if (expectedTotal !== undefined && !totalsMatch(booking, expectedTotal, booking.totalPrice)) {
        res.status(409).json({
            success: false,
            code: "PRICE_CHANGED",
            message: "The price for this booking has changed. Please review the new total.",
            details: { previousTotal: expectedTotal, newTotal: booking.totalPrice, currency }
        });
        return true;
    }
    return false;
};

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

         // The total the customer last saw and confirmed (optional). If it isn't the supplier's
        // current total, payment doesn't start and the customer is asked to confirm again.
        let expectedTotal: number | undefined;
        if (req.body.expectedTotal !== undefined && req.body.expectedTotal !== null) {
                const parsed = Number(req.body.expectedTotal);
                if (!Number.isFinite(parsed) || parsed <= 0) {
                    return res.status(400).json({
                    success: false,
                    message: "expectedTotal must be a positive number",
                });
            }
            expectedTotal = parsed;
        }

        // Find booking
        const booking = await Booking.findOne({ _id: bookingId, userId });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        //Layer 1: is the booking itself payable? (pending + unpaid only)
        const eligibility = checkPaymentEligibility(booking)
        if (!eligibility.eligible) {
            return res.status(409).json({
                success: false,
                code: eligibility.code,
                message: eligibility.message
            })
        }

        //Layer2: what do this booking's earlier payment attempts allow?
        const blockingAttempts = await paymentAttemptService.getBlockingAttempts(booking._id);
        const retry = decideAttemptRetry(blockingAttempts);

        if (retry.action === "reject") {
            return res.status(409).json({
                success: false,
                code: retry.code,
                message: retry.message
            });
        }

        if (retry.action === "resume") {
            const existing = retry.attempt;

            //Ask Paystack what happened to the earlier attempt before doing anything.
            let verification: VerifiedPayment;
            try {
                verification = await paystackService.verifyPayment(existing.reference);
            } catch (verifyError) {
                console.error(`Could not verify earlier attempt ${existing.reference}:`, verifyError);
                return res.status(503).json({
                    success: false,
                    code: "VERIFICATION_UNAVAILABLE",
                    message: "We couldn't confirm your earlier payment attempt. Please try again shortly.",
                });
            }

            //the earlier attempt was actually paid: settle it, don't start another.
            if (verification.success) {
                await settleAttemptPayment(booking, existing, verification, "verify");
                return res.status(409).json({
                    success: false,
                    code: "ALREADY_PAID",
                    message: "Your earlier payment went through. Your booking is being finalised.",
                });
            }

            const outcome = await paymentAttemptService.recordOutcome(
                existing.reference,
                toOutcomeInput(verification),
                "verify"
            );
            const current = outcome.attempt;

            if (current?.status === "success") {
                return res.status(409).json({
                    success: false,
                    code: "ALREADY_PAID",
                    message: "Payment for this booking has already been received",
                });
            }

            if (current?.status === "unknown") {
                return res.status(409).json({
                    success: false,
                    code: "PAYMENT_UNDER_REVIEW",
                    message: "An earlier payment for this booking is being reviewed. Please contact support",
                });
            }

            // Paystack still reports this attempt as open. It may still be payable,
            // so it is never released just because it is old: only a final Paystack
            // outcome (handled above) allows a new attempt.
            if (current?.status === "pending") {
                if (!current.authorizationUrl) {
                    // The checkout link was lost when initialization timed out, so nobody
                    // holds a link to this attempt and nobody can pay it. Safe to close.
                    const closed = await paymentAttemptService.closeUnreachable(current._id);
                    if (!closed) {
                        return res.status(409).json({
                            success: false,
                            code: "PAYMENT_IN_PROGRESS",
                            message: "A payment is already being resolved for this booking. Please try again shortly.",
                        });
                    }
                    // fall through to a new attempt
                } else {
                    // Hand back the SAME link instead of a second payment, but only if the 
                    //price it was created for still holds. Otherwise this closes it.
                    if (await rejectIfPriceNotConfirmed(booking, expectedTotal, current, res)) return;

                    return res.status(200).json({
                        success: true,
                        message: "Existing payment resumed",
                        data: {
                            authorizationUrl: current.authorizationUrl,
                            reference: current.reference,
                            accessCode: current.accessCode,
                            resumed: true,
                        },
                    });
                }
            }
            //earlier attempt is now failed: fall through and start a new one
        }

        // Re-check the supplier's price BEFORE working out what to charge, so the charge is
        // never built from a stored (possibly outdated) total.
        if (await rejectIfPriceNotConfirmed(booking, expectedTotal, null, res)) return;

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

        const reservation = await paymentAttemptService.reserve({
            bookingId: booking._id,
            userId,
            bookingReference: booking.bookingReference,
            amount: chargeAmount,
            currency: SETTLEMENT_CURRENCY,
            currencyConversion,
            quotedTotal: booking.totalPrice,
            quotedCurrency: supplierCurrency(booking)
        });

        if (reservation.conflict) {
            return res.status(409).json({
                success: false,
                code: "PAYMENT_IN_PROGRESS",
                message: "A payment is already being set up for this booking. Please try again in a moment.",
            });
        }

        const attempt: PaymentAttemptDocument = reservation.attempt;

        //initialize paystack payment under this attempts own unique reference
        let paymentData: Awaited<ReturnType<typeof paystackService.initializePayment>>;
        try {
            paymentData = await paystackService.initializePayment(
                userEmail,
                chargeAmount,
                attempt.reference,
                {
                    bookingReference: booking.bookingReference,
                    bookingId: booking._id.toString(),
                    bookingType: booking.bookingType,
                    userId: userId.toString(),
                    attemptId: attempt._id.toString(),
                    ...(currencyConversion ? { currencyConversion } : {}),
                }
            );
        } catch (initError: any) {
            if (isAmbiguousPaystackError(initError)) {
                await paymentAttemptService.noteInitializationUncertain(attempt._id, initError.message);
                return res.status(503).json({
                    success: false,
                    code: "PAYMENT_STATUS_UNCERTAIN",
                    message: "We couldn't confirm the payment setup with our payment provider. Please wait a few minutes and try again.",
                });
            }

            // Paystack clearly refused: nothing was created, so release the booking.
            await paymentAttemptService.markInitializationFailed(attempt._id, initError?.message ?? "unknown");
            throw initError;
        }

        // If the attempt was resolved by something else while we waited, the link is
        // not tied to a live attempt any more: don't hand it to the customer.
        const pendingAttempt = await paymentAttemptService.markPending(attempt._id, {
            authorizationUrl: paymentData.authorizationUrl,
            accessCode: paymentData.accessCode,
        });

        if (!pendingAttempt) {
            return res.status(409).json({
                success: false,
                code: "PAYMENT_IN_PROGRESS",
                message: "This payment attempt is no longer current. Please try again.",
            });
        }

        // Keep the booking's payment summary pointing at the latest attempt.
        // paymentStatus stays "unpaid": the attempt record holds the in-flight
        // state. Conditional on unpaid so a concurrent settlement is never clobbered.
        const bookingUpdate: Record<string, any> = {
            $set: {
                paymentReference: attempt.reference,
                paymentMethod: "paystack",
                authorizationUrl: paymentData.authorizationUrl,
                accessCode: paymentData.accessCode,
                paymentInitiatedAt: new Date(),
                ...(currencyConversion ? { currencyConversion } : {}),
            },
        };
        if (!currencyConversion) {
            bookingUpdate.$unset = { currencyConversion: "" };
        }
        await Booking.updateOne({ _id: booking._id, paymentStatus: "unpaid" }, bookingUpdate);

        res.status(200).json({
            success: true,
            message: "Payment initialized successfully",
            data: {
                authorizationUrl: paymentData.authorizationUrl,
                reference: attempt.reference,
                accessCode: paymentData.accessCode,
                resumed: false,
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

// Verify payment and confirm booking
export const verifyPayment = async (req: Request, res: Response) => {
    try {
        const { reference } = req.query as { reference?: string };
        const userId = (req as any).user?.id || (req as any).userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        if (!reference || typeof reference !== "string") {
            return res.status(400).json({
                success: false,
                message: "Payment reference is required",
            });
        }

        // Attempt first (covers old links too), then its booking. Bookings paid
        // before attempts existed are still found by their stored reference.
        const attempt = await paymentAttemptService.findByReference(reference);
        const booking = attempt ? await Booking.findOne({ _id: attempt.bookingId, userId}): await Booking.findOne({ paymentReference: reference, userId });

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: "Booking not found",
            });
        }

        // Verify payment with Paystack
        let paymentData: VerifiedPayment;
        try {
            paymentData = await paystackService.verifyPayment(reference);
        } catch (verifyError) {
            console.error(`Could not verify payment ${reference}:`, verifyError);
            if (attempt) {
                // note the check, change no status
                await paymentAttemptService.recordOutcome(reference, { providerStatus: null }, "verify");
            }
            return res.status(503).json({
                success: false,
                code: "VERIFICATION_UNAVAILABLE",
                message: "We couldn't verify your payment right now. Please try again shortly.",
            });
        }

        if (!paymentData.success) {
            if (attempt) {
                await paymentAttemptService.recordOutcome(reference, toOutcomeInput(paymentData), "verify");
            }
            return res.status(400).json({
                success: false,
                code: paymentData.status === "failed" ? "PAYMENT_FAILED" : "PAYMENT_NOT_COMPLETED",
                status: paymentData.status,
                message: "Payment verification failed",
            });
        }

        const settled = await settleAttemptPayment(booking, attempt, paymentData, "verify");

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

        const attempt = await paymentAttemptService.findByReference(reference);
        const booking = attempt
            ? await Booking.findById(attempt.bookingId)
            : await Booking.findOne({ paymentReference: reference });

        if (!booking) {
            console.warn(`Webhook received for unknown booking reference: ${reference}`);
            return res.status(200).json({ success: true, message: "No matching booking" });
        }

        const paymentData = await paystackService.verifyPayment(reference);

        if (!paymentData.success) {
            if (attempt) {
                await paymentAttemptService.recordOutcome(reference, toOutcomeInput(paymentData), "webhook");
            }
            return res.status(200).json({ success: true, message: "Re-verification did not confirm success" });
        }

        await settleAttemptPayment(booking, attempt, paymentData, "webhook");

        res.status(200).json({ success: true, message: "Webhook processed" });
    } catch (error: any) {
        console.error("Paystack Webhook Error:", error);
        res.status(500).json({ success: false, message: "Webhook processing failed" });
    }
};