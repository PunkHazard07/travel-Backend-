import PaymentAttempt, {
    attemptStatusFields,
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

export const paymentAttemptService = {
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