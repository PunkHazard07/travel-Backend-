import { describe, it, expect } from "@jest/globals";
import { PaystackError, classifyPaystackError, isAmbiguousPaystackError } from "../utils/paystackErrors.js";

const httpError = (status: number, message?: string) => ({ response: { status, data: message ? { message } : {} } });

describe("classifyPaystackError", () => {
    it("no response at all (timeout, network drop) is unavailable", () => {
        const result = classifyPaystackError(new Error("timeout of 15000ms exceeded"), "Failed");
        expect(result.kind).toBe("unavailable");
        expect(result.httpStatus).toBeNull();
    });

    it.each([500, 502, 503, 408, 429])("HTTP %i is unavailable", (status) => {
        expect(classifyPaystackError(httpError(status), "Failed").kind).toBe("unavailable");
    });

    it.each([400, 401, 403, 422])("HTTP %i is a definite rejection", (status) => {
        const result = classifyPaystackError(httpError(status, "Invalid key"), "Failed");
        expect(result.kind).toBe("rejected");
        expect(result.httpStatus).toBe(status);
        expect(result.message).toBe("Invalid key");
    });

    it("404 is not_found", () => {
        expect(classifyPaystackError(httpError(404), "Failed").kind).toBe("not_found");
    });

    it("the 'no transaction could be found' message is not_found even on another 4xx", () => {
        const result = classifyPaystackError(httpError(400, "No transaction could be found with this transaction reference"), "Failed");
        expect(result.kind).toBe("not_found");
    });

    it("uses the fallback message when Paystack gave none", () => {
        expect(classifyPaystackError(httpError(400), "Failed to verify payment").message).toBe("Failed to verify payment");
    });

    it("returns an existing PaystackError unchanged", () => {
        const original = new PaystackError("x", "rejected", 400);
        expect(classifyPaystackError(original, "Failed")).toBe(original);
    });
});

describe("isAmbiguousPaystackError", () => {
    it("is true only for unavailable PaystackErrors", () => {
        expect(isAmbiguousPaystackError(new PaystackError("x", "unavailable"))).toBe(true);
        expect(isAmbiguousPaystackError(new PaystackError("x", "rejected", 400))).toBe(false);
        expect(isAmbiguousPaystackError(new PaystackError("x", "not_found", 404))).toBe(false);
        expect(isAmbiguousPaystackError(new Error("boom"))).toBe(false);
    });
});