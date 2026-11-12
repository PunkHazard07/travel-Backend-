import mongoose, { Schema, type Document, type Types } from "mongoose";
import { randomBytes } from "crypto";

export const ATTEMPT_STATUSES = [
    "initiating", // reserved in our DB, Paystack not called yet (or call in flight)
    "pending",    // Paystack issued a link; no final outcome yet
    "success",    // Paystack verified the charge as successful
    "failed",     // Paystack verified the charge as failed
    "expired",  
    "unknown",    // could not establish the outcome; awaiting reconciliation
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

//status that block a new attempt for the same booking
export const ACTIVE_ATTEMPT_STATUSES: readonly AttemptStatus[] = ["initiating", "pending", "unknown"];

export const isActiveAttemptStatus = (status: AttemptStatus): boolean => ACTIVE_ATTEMPT_STATUSES.includes(status);

export const attemptStatusFields = (status: AttemptStatus): { status: AttemptStatus; isActive: boolean } => ({
    status,
    isActive: isActiveAttemptStatus(status),
});

export const RESOLVED_BY = ["verify", "webhook", "reconcile"] as const;
export type ResolvedBy = (typeof RESOLVED_BY)[number];

export const generateAttemptReference = (bookingReference: string): string =>`${bookingReference}-${randomBytes(4).toString("hex").toUpperCase()}`;

export interface AttemptCurrencyConversion {
    from?: string;
    to?: string;
    originalAmount?: number;
    convertedAmount?: number;
}

export interface PaymentAttemptDocument extends Document {
    bookingId: Types.ObjectId;
    userId: Types.ObjectId;
    reference: string;

    //what this attempt asked Paystack to charge
    amount: number;
    currency: string;
    currencyConversion?: AttemptCurrencyConversion;
    status: AttemptStatus;
    isActive: boolean;

    authorizationUrl: string | null;
    accessCode: string | null;
    // Verification outcome and provider information.
    providerStatus: string | null;
    gatewayResponse: string | null;
    channel: string | null;
    paidAmount: number | null;
    paidAt: Date | null;
    failureReason: string | null;
    resolvedBy: ResolvedBy | null;
    verifiedAt: Date | null;
    lastCheckedAt: Date | null;
    verifyAttempts: number;
 
    // Managed by mongoose via `timestamps: true`.
    createdAt: Date;
    updatedAt: Date;
}

const paymentAttemptSchema = new Schema<PaymentAttemptDocument>({
    bookingId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "Booking",
    },
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "User",
    },
    reference: {
        type: String,
        required: true,
        unique: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    currency: {
        type: String,
        required: true,
        default: "NGN",
    },
    currencyConversion: {
            from: String,
            to: String,
            originalAmount: Number,
            convertedAmount: Number,
        },
        status: {
            type: String,
            enum: ATTEMPT_STATUSES,
            default: "initiating",
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        authorizationUrl: {
            type: String,
            default: null,
        },
        accessCode: {
            type: String,
            default: null,
        },
        providerStatus: {
            type: String,
            default: null,
        },
        gatewayResponse: {
            type: String,
            default: null,
        },
        channel: {
            type: String,
            default: null,
        },
        paidAmount: {
            type: Number,
            default: null,
        },
        paidAt: {
            type: Date,
            default: null,
        },
        failureReason: {
            type: String,
            default: null,
        },
        resolvedBy: {
            type: String,
            enum: RESOLVED_BY,
            default: null,
        },
        verifiedAt: {
            type: Date,
            default: null,
        },
        lastCheckedAt: {
            type: Date,
            default: null,
        },
        verifyAttempts: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }  
);

// Keep isActive in step with status for documents saved through mongoose.
paymentAttemptSchema.pre("validate", function (next) {
    if (this.isNew || this.isModified("status")) {
        this.isActive = isActiveAttemptStatus(this.status);
    }
    next();
});

//history for a booking, newest first
paymentAttemptSchema.index({ bookingId: 1, createdAt: -1 });

paymentAttemptSchema.index(
    { bookingId: 1 },
    {
        unique: true,
        partialFilterExpression: { isActive: true },
        name: "one_active_attempt_per_booking",
    }
);

// Reconciliation scan: unresolved attempts, oldest first.
paymentAttemptSchema.index(
    { createdAt: 1 },
    {
        partialFilterExpression: { isActive: true },
        name: "active_attempts_by_age",
    }
);

const PaymentAttempt = mongoose.model<PaymentAttemptDocument>("PaymentAttempt", paymentAttemptSchema);

export default PaymentAttempt;