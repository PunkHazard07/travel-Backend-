import dotenv from "dotenv";
dotenv.config();

const BOOK_BASE_URL = "https://book.liteapi.travel/v3.0";

const PREBOOK_TIMEOUT_MS = 20_000;

const BOOK_TIMEOUT_MS = 60_000;

export type LiteApiErrorKind = "rejected" | "unknown";

export class LiteApiError extends Error {
    readonly kind: LiteApiErrorKind;
    readonly status?: number;
    readonly body?: unknown;

    constructor(message: string, kind: LiteApiErrorKind, status?: number, body?: unknown) {
        super(message);
        this.name = "LiteApiError";
        this.kind = kind;
        this.status = status;
        this.body = body;
    }
}

export const classifyHttpStatus = (status: number): LiteApiErrorKind =>
    status >= 500 || status === 408 || status === 429 ? "unknown" : "rejected";

const postJson = async (path: string, body: unknown, timeoutMs: number): Promise<any> => {
    const apiKey = process.env.LITE_KEY;
    if (!apiKey) {
        throw new LiteApiError("LITE_KEY is not set", "rejected");
    }

    let response: Response;
    try {
        response = await fetch(`${BOOK_BASE_URL}${path}`, {
            method: "POST",
            headers: {
                "X-API-Key": apiKey,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch (error: any) {
        throw new LiteApiError(`LiteAPI request failed: ${error?.message ?? error}`, "unknown");
    }

    const text = await response.text();
    let json: any = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (error) {
        json = null;
    }

    if (!response.ok) {
        const message = json?.error?.message ?? json?.error?.description ?? json?.message ?? `LiteAPI returned status ${response.status}`;
        throw new LiteApiError(String(message), classifyHttpStatus(response.status), response.status, json);
    }

    // A 200 carrying an error object and no data is still a refusal.
    if (!json || json.data == null) {
        if(json?.error) {
            throw new LiteApiError(String(json.error.message ?? "LiteAPI returned an error"), "rejected", response.status, json);
        }
        throw new LiteApiError("LiteAPI returned an empty response", "unknown", response.status, json);
    }
    return json.data;
};

// Locks in a rate and returns the authoritative price. Moves no money.
export const prebookRate = (offerId: string): Promise<any> => 
    postJson("/rates/prebook", { offerId, usePaymentSdk: false }, PREBOOK_TIMEOUT_MS);

export interface BookRequestBody {
    prebookId: string;
    holder: { firstName: string; lastName: string; email: string; phone?: string };
    guests: { occupancyNumber: number; firstName: string; lastName: string; email?: string }[];
    payment: { method: string };
    clientReference: string;
}

export const bookRate = (body: BookRequestBody): Promise<any> =>
    postJson("/rates/book", body, BOOK_TIMEOUT_MS);