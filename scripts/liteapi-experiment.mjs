import "dotenv/config";
import { writeFileSync } from "node:fs";

const BASE = "https://book.liteapi.travel/v3.0";
const KEY = process.env.LITE_KEY;
const OFFER_ID = process.env.OFFER_ID;
const PAYMENT_METHOD = process.env.LITE_PAYMENT_METHOD || "ACC_CREDIT_CARD";
const EMAIL = process.env.HOLDER_EMAIL || "sandbox.test@example.com";

if (!KEY) throw new Error("LITE_KEY is not set");
if (!OFFER_ID) throw new Error("OFFER_ID is not set (take one from your own /hotels/rates response)");
if (process.env.CONFIRM_SANDBOX !== "yes") throw new Error("Set CONFIRM_SANDBOX=yes to confirm this is a sandbox key");
if (/^prod/i.test(KEY)) throw new Error("This looks like a production key. Refusing to run.");

const results = [];

const call = async (label, method, path, body) => {
    const url = `${BASE}${path}`;
    let status = null;
    let parsed = null;
    let error = null;

    try {
        const response = await fetch(url, {
            method,
            headers: { "X-API-Key": KEY, Accept: "application/json", "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(60_000),
        });
        status = response.status;
        const text = await response.text();
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            parsed = text;
        }
    } catch (e) {
        error = String(e?.message ?? e);
    }

    const entry = { label, request: { method, path, body: body ?? null }, status, response: parsed, error };
    results.push(entry);
    console.log(`\n=== ${label}\n${method} ${path} -> ${status ?? "NO RESPONSE"}${error ? ` (${error})` : ""}`);
    console.log(JSON.stringify(parsed, null, 2)?.slice(0, 1500));
    return entry;
};

const ref = `EXP-${Date.now()}`;
const missingRef = `EXP-DOES-NOT-EXIST-${Date.now()}`;

const bookBody = (prebookId, clientReference) => ({
    prebookId,
    holder: { firstName: "Test", lastName: "Sandbox", email: EMAIL },
    guests: [{ occupancyNumber: 1, firstName: "Test", lastName: "Sandbox", email: EMAIL }],
    payment: { method: PAYMENT_METHOD },
    clientReference,
});

// 1. Prebook
const prebook = await call("1. prebook", "POST", "/rates/prebook", { offerId: OFFER_ID, usePaymentSdk: false });
const prebookId = prebook.response?.data?.prebookId;
if (!prebookId) {
    console.log("\nNo prebookId, stopping. Check OFFER_ID (offers expire) and your key.");
    writeFileSync("scripts/liteapi-experiments-output.json", JSON.stringify(results, null, 2));
    process.exit(1);
}

// 2. Book once with a known clientReference
const book = await call("2. book (first time)", "POST", "/rates/book", bookBody(prebookId, ref));
const bookingId = book.response?.data?.bookingId;

// 3. Can we find it by clientReference?
await call("3a. list bookings by clientReference (exists)", "GET", `/bookings?clientReference=${encodeURIComponent(ref)}`);

// 4. What does "nothing found" look like? (this is your definition of not_found)
await call("3b. list bookings by clientReference (does NOT exist)", "GET", `/bookings?clientReference=${encodeURIComponent(missingRef)}`);

// 5. Retrieve one booking by id (status values live here)
if (bookingId) await call("4. retrieve booking by id", "GET", `/bookings/${encodeURIComponent(bookingId)}`);

// 6. Re-send the identical request: is clientReference really an idempotency key?
await call("5a. book again, same prebookId + same clientReference", "POST", "/rates/book", bookBody(prebookId, ref));

// 7. Re-send with a different clientReference: is the prebookId single-use?
await call("5b. book again, same prebookId + DIFFERENT clientReference", "POST", "/rates/book", bookBody(prebookId, `${ref}-B`));

// 8. How many bookings exist for the original reference now? (1 = idempotent, 2 = duplicate)
await call("6. list bookings by clientReference (after re-sends)", "GET", `/bookings?clientReference=${encodeURIComponent(ref)}`);

writeFileSync("scripts/liteapi-experiments-output.json", JSON.stringify(results, null, 2));
console.log("\nDone. Full output saved to scripts/liteapi-experiments-output.json");