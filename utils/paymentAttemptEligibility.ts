import type { AttemptStatus } from "../Model/paymentAttempt.js";

export type AttemptRetryCode = "ALREADY_PAID" | "PAYMENT_IN_PROGRESS" | "PAYMENT_UNDER_REVIEW";

export type AttemptRetryDecision<T> = {
    action: "create" | "resume" | "reject";
    attempt?: T;          // set when action is "resume"
    code?: AttemptRetryCode;
    message?: string;     // set when action is "reject"
};

export const decideAttemptRetry = <T extends { status: AttemptStatus }>(attempts: T[]): AttemptRetryDecision<T> => {
    if (attempts.some((attempt) => attempt.status === "success")) {
        return { action: "reject", code: "ALREADY_PAID", message: "Payment for this booking has already been received"};
    }

    if (attempts.some((attempt) => attempt.status === "unknown")) {
        return {
            action: "reject",
            code: "PAYMENT_UNDER_REVIEW",
            message: "An earlier payment for this booking is being reviewed. Please contact support"
        };
    }

    if (attempts.some((attempt) => attempt.status === "initiating")) {
        return {
            action: "reject",
            code: "PAYMENT_IN_PROGRESS",
            message: "A payment is already being set up for this booking. Please try again in a moment"
        };
    }

    const pending = attempts.find((attempt) => attempt.status === "pending");
    if (pending) {
        return { action: "resume", attempt: pending };
    }

    return { action: "create" };
}