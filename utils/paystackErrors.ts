// How a failed Paystack call should be understood. The key question for
// initialize is: "did Paystack definitely refuse, or do we simply not know?"
//
//  rejected    - Paystack answered with a 4xx: it looked at the request and said no.
//                Nothing was created, so closing our attempt as failed is safe.
//  not_found   - (verify) Paystack answered "no transaction with this reference".
//  unavailable - no answer (timeout, network drop) or a 5xx / 408 / 429. The
//                request MAY have been processed. We must not assume either way.
export type PaystackErrorKind = "rejected" | "not_found" | "unavailable";

export class PaystackError extends Error {
    readonly kind: PaystackErrorKind;
    readonly httpStatus: number | null;

    constructor(message: string, kind: PaystackErrorKind, httpStatus: number | null = null) {
        super(message);
        this.name = "PaystackError";
        this.kind = kind;
        this.httpStatus = httpStatus;
    }
}

const NOT_FOUND_PATTERN = /no transaction could be found|could not be found|not found/i;

// Turns whatever axios threw into a PaystackError. Pure: no I/O.
export const classifyPaystackError = (error: any, fallbackMessage: string): PaystackError => {
    if (error instanceof PaystackError) return error;

    const response = error?.response;

    // No response at all: timeout, DNS failure, connection reset...
    if (!response) {
        return new PaystackError(fallbackMessage, "unavailable", null);
    }

    const status: number = response.status;
    const message: string = response.data?.message || fallbackMessage;

    if (status >= 500 || status === 408 || status === 429) {
        return new PaystackError(message, "unavailable", status);
    }

    if (status === 404 || NOT_FOUND_PATTERN.test(message)) {
        return new PaystackError(message, "not_found", status);
    }

    return new PaystackError(message, "rejected", status);
};

// True only when we genuinely cannot tell whether Paystack created the transaction.
export const isAmbiguousPaystackError = (error: unknown): boolean =>
    error instanceof PaystackError && error.kind === "unavailable";