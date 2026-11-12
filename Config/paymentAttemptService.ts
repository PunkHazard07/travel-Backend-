import PaymentAttempt, {
    attemptStatusFields,
    generateAttemptReference,
    type AttemptStatus,
    type PaymentAttemptDocument,
    type ResolvedBy,
} from "../Model/paymentAttempt.js";

//what a verify call (or webhook re-verification) tells us about one attempt
export type ProviderVerification = {
    // Raw Paystack status. null means the verify call itself failed.
    providerStatus: string | null;
    gatewayResponse?: string | null;
    channel?: string | null;
    amount?: number | null;
    paidAt?: string | Date | null;
};

export type TransitionDecision = {
    next: AttemptStatus;
    allowedFrom: AttemptStatus[];
};

const OPEN: AttemptStatus[] = ["initiating", "pending", "unknown"];

export const decideTransition = (providerStatus: string | null | undefined): TransitionDecision | null => {
    switch ((providerStatus ?? "").toLowerCase()) {
        case "success": 
            return { next: "success", allowedFrom: ["initiating", "pending", "unknown", "failed", "expired"] };
        case "failed": 
            return { next: "failed", allowedFrom: OPEN };
        case "abandoned":
        case "ongoing":
        case "pending":
        case "processing":
        case "queued":
            return { next: "pending", allowedFrom: OPEN };
        case "reversed":
            return { next: "unknown", allowedFrom: ["initiating", "pending"] };
        default:
            return null;
    }
};

export const canTransition = (current: AttemptStatus, providerStatus: string | null | undefined): boolean =>
    decideTransition(providerStatus)?.allowedFrom.includes(current) ?? false;

export type RecordOutcomeResult = {
    found: boolean; //an attempt with this reference exists
    applied: boolean; // this call changed the attempts's status
    attempt: PaymentAttemptDocument | null;
};

const toDate = (value: string | Date | null | undefined): Date | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

export type ReserveAttemptInput = {
    bookingId: any;
    userId: any;
    bookingReference: string;
    amount: number;
    currency: string;
    currencyConversion?: {
        from: string;
        to: string;
        originalAmount: number;
        convertedAmount: number;
    } | null;
};

export type ReserveAttemptResult = {
    // true when another request already holds the booking's one active attempt
    conflict: boolean;
    attempt: PaymentAttemptDocument | null;
};

const isDuplicateKeyError = (error: any): boolean => error?.code === 11000;

export const paymentAttemptService = {
    async getBlockingAttempts(bookingId: any): Promise<PaymentAttemptDocument[]> {
        return PaymentAttempt.find({
            bookingId,
            status: { $in: ["success", "initiating", "pending", "unknown"] }
        }).sort({ createdAt: -1 });
    },

    async findByReference(reference: string): Promise<PaymentAttemptDocument | null> {
        return PaymentAttempt.findOne({ reference });
    },

    // Reserve the booking's single active attempt BEFORE calling Paystack.
    // The partial unique index (one_active_attempt_per_booking) lets exactly
    // one of several simultaneous requests succeed; the rest get conflict: true.
    async reserve(input: ReserveAttemptInput): Promise<ReserveAttemptResult> {
        try {
            const attempt = await PaymentAttempt.create({
                bookingId: input.bookingId,
                userId: input.userId,
                reference: generateAttemptReference(input.bookingReference),
                amount: input.amount,
                currency: input.currency,
                currencyConversion: input.currencyConversion ?? undefined,
                ...attemptStatusFields("initiating"),
            });
            return { conflict: false, attempt };
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                return { conflict: true, attempt: null };
            }
            throw error;
        }
    },

    //initiate pending once paystack has issued the link. So it doesn't overwrite an attempt that's something else already resolved.
    async markPending(attemptId: any, link: { authorizationUrl: string; accessCode: string }): Promise<PaymentAttemptDocument | null> {
        return PaymentAttempt.findOneAndUpdate({
            _id: attemptId, status: "initiating" },
            {
                $set: {
                    ...attemptStatusFields("pending"),
                    authorizationUrl: link.authorizationUrl,
                    accessCode: link.accessCode
                },
            },
            { new: true }
        );
    },

    //paystack refused to initialise: close the attempt so the customer can retry.
    async markInitializationFailed(attemptId: any, reason: string): Promise<void> {
        await PaymentAttempt.updateOne(
            { _id: attemptId, status: "initiating" },
            {
                $set: {
                    ...attemptStatusFields("failed"),
                    failureReason: `initialization_failed: ${reason}`.slice(0, 300),
                    verifiedAt: new Date(),
                },
            }
        );
    },

    // We stopped waiting on this attempt (unpaid past our time limit). Guarded to
    // pending only, so it can never overwrite a payment that landed a moment ago.
    // Paystack may still accept money on the old link; a late success is still
    // recorded because success may overwrite expired (see decideTransition).
    async expire(attemptId: any): Promise<PaymentAttemptDocument | null> {
        return PaymentAttempt.findOneAndUpdate(
            { _id: attemptId, status: "pending" },
            {
                $set: {
                    ...attemptStatusFields("expired"),
                    failureReason: "expired_unpaid",
                    resolvedBy: "reconcile",
                    verifiedAt: new Date(),
                },
            },
            { new: true }
        );
    },

    // Attempts the sweep should look at, oldest first:
    //  - initiating ones older than initiatingBefore (the link never reached the customer)
    //  - pending/unknown ones older than recheckBefore that we haven't checked since then
    async findStaleAttempts(options: {initiatingBefore: Date; recheckBefore: Date; limit: number; }): Promise<PaymentAttemptDocument[]> {
        return PaymentAttempt.find({
            isActive: true,
            $or: [
                { status: "initiating", createdAt: { $lt: options.initiatingBefore } },
                {
                    status: { $in: ["pending", "unknown"] },
                    createdAt: { $lt: options.recheckBefore },
                    $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $lt: options.recheckBefore } }],
                },
            ],
        })
        .sort({ createdAt: 1 })
        .limit(options.limit);
    },  

    // Money arrived on this attempt, but the booking was already settled by a
    // different one. Refund is a manual step for now; this makes it findable.
    async flagDuplicatePayment(attemptId: any): Promise<void> {
        await PaymentAttempt.updateOne(
            { _id: attemptId },
            { $set: { failureReason: "duplicate_payment_refund_required"}}
        );
    },
    
    //single entry point for webhook, verify and the reconcile job.
    async recordOutcome(reference: string, verification: ProviderVerification, source: ResolvedBy): Promise<RecordOutcomeResult> {
        const now = new Date();
        const decision = decideTransition(verification.providerStatus)

        if (decision) {
            const set: Record<string, any> = {
                ...attemptStatusFields(decision.next),
                providerStatus: String(verification.providerStatus).toLowerCase(),
                gatewayResponse: verification.gatewayResponse ?? null,
                lastCheckedAt: now,
            };

        if (decision.next === "success") {
                set.paidAmount = verification.amount ?? null;
                set.paidAt = toDate(verification.paidAt);
                set.channel = verification.channel ?? null;
                set.failureReason = null;
                set.resolvedBy = source;
                set.verifiedAt = now;
            } else if (decision.next === "failed") {
                set.failureReason = verification.gatewayResponse ?? "failed";
                set.resolvedBy = source;
                set.verifiedAt = now;
            } else if (decision.next === "unknown") {
                set.failureReason = "reversed_or_chargeback";
                set.resolvedBy = source;
                set.verifiedAt = now;
            }

            const updated = await PaymentAttempt.findOneAndUpdate(
                { reference, status: { $in: decision.allowedFrom } },
                { $set: set, $inc: { verifyAttempts: 1 } },
                { new: true }
            );

            if (updated) {
                return { found: true, applied: true, attempt: updated };
            }
        }

         // Either nothing to apply (verify unavailable / unrecognised status) or
        // the guard refused (already resolved by another writer). Record that we
        // looked, without touching status or outcome fields.
        const current = await PaymentAttempt.findOneAndUpdate(
            { reference },
            { $set: { lastCheckedAt: now }, $inc: { verifyAttempts: 1 } },
            { new: true }
        );

        return { found: Boolean(current), applied: false, attempt: current ?? null };
    }
}