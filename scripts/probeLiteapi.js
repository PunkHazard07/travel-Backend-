import dotenv from "dotenv";
dotenv.config();

const key = process.env.LITE_KEY;
if (!key) {
  console.error("LITE_KEY is not set");
  process.exit(1);
}
if (!key.startsWith("sand_")) {
  console.error("Refusing to run: LITE_KEY does not look like a sandbox key (sand_...). This script makes a real booking call.");
  process.exit(1);
}

const args = process.argv.slice(2);
const retry = args.includes("--retry");
const [city = "Lagos", country = "NG"] = args.filter((a) => !a.startsWith("--"));
const paymentMethod = process.env.LITE_PAYMENT_METHOD || "ACC_CREDIT_CARD";

const fmt = (d) => d.toISOString().slice(0, 10);
const inDate = new Date(Date.now() + 14 * 86400000);
const outDate = new Date(inDate.getTime() + 2 * 86400000);

const shape = (v, depth = 0) => {
  if (v === null) return "null";
  if (Array.isArray(v)) return depth > 6 ? "[...]" : v.length ? [`(${v.length}x)`, shape(v[0], depth + 1)] : [];
  if (typeof v === "object") {
    if (depth > 6) return "{...}";
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)]));
  }
  return typeof v;
};

const post = async (url, body, timeoutMs) => {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-API-Key": key, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, ms: Date.now() - started };
  } catch (error) {
    return { status: 0, json: null, text: String(error?.message || error), ms: Date.now() - started, networkError: true };
  }
};

// Mirrors Config/liteBooking.ts and utils/hotelBooking.ts so the verdict below
// is what the server would conclude.
const classify = (res) => {
  if (res.networkError) return "unknown";
  if (res.status >= 500 || res.status === 408 || res.status === 429) return "unknown";
  if (res.status >= 400) return "rejected";
  const hasData = res.json && res.json.data != null;
  if (res.json?.error && !hasData) return "rejected";
  if (!res.text || !res.json) return "unknown";
  return hasData ? "ok" : "unknown";
};

const mapBook = (data) => {
  const status = typeof data?.status === "string" ? data.status : null;
  const bookingId = data?.bookingId != null ? String(data.bookingId) : null;
  return {
    confirmed: status?.toUpperCase() === "CONFIRMED" && bookingId !== null,
    status,
    bookingId,
    hotelConfirmationCode: data?.hotelConfirmationCode ?? null,
    supplierBookingId: data?.supplierBookingId ?? null,
  };
};

console.log(`Sandbox key detected. Payment method: ${paymentMethod}. Searching ${city}, ${country}...`);

const rates = await post("https://api.liteapi.travel/v3.0/hotels/rates", {
  cityName: city,
  countryCode: country,
  checkin: fmt(inDate),
  checkout: fmt(outDate),
  currency: "NGN",
  guestNationality: "US",
  occupancies: [{ adults: 1 }],
}, 30000);

const hotel = rates.json?.data?.find((h) => h?.roomTypes?.some((r) => r?.offerId));
if (!hotel) {
  console.error("rates status:", rates.status, "- no hotel with an offerId found");
  process.exit(1);
}
const roomType = hotel.roomTypes.find((r) => r?.offerId);

const prebook = await post("https://book.liteapi.travel/v3.0/rates/prebook", { offerId: roomType.offerId, usePaymentSdk: false }, 20000);
console.log("\nprebook status:", prebook.status, `(${prebook.ms} ms)`);
if (prebook.status !== 200 || !prebook.json?.data?.prebookId) {
  console.error(prebook.text.slice(0, 500));
  process.exit(1);
}

const pre = prebook.json.data;
const allowed = Array.isArray(pre.paymentTypes) ? pre.paymentTypes : [];
console.log("prebookId:", pre.prebookId);
console.log("price / currency:", pre.price, pre.currency);
console.log("prebook paymentTypes:", JSON.stringify(allowed));
console.log("rate-level paymentTypes:", JSON.stringify(pre.roomTypes?.[0]?.rates?.[0]?.paymentTypes));
console.log("cancellationChanged / boardChanged / priceDifferencePercent:", pre.cancellationChanged, pre.boardChanged, pre.priceDifferencePercent);
if (allowed.length && !allowed.includes(paymentMethod)) {
  console.log(`WARNING: "${paymentMethod}" is not in the prebook's paymentTypes. The book call may be rejected.`);
}

const clientReference = `PROBE-${Date.now().toString(36).toUpperCase()}`;
const bookBody = {
  prebookId: pre.prebookId,
  holder: { firstName: "Test", lastName: "Probe", email: process.env.PROBE_EMAIL || "probe@example.com" },
  guests: [{ occupancyNumber: 1, firstName: "Test", lastName: "Probe", email: process.env.PROBE_EMAIL || "probe@example.com" }],
  payment: { method: paymentMethod },
  clientReference,
};

const report = (label, res) => {
  console.log(`\n=== ${label} ===`);
  console.log("HTTP status:", res.status, `(${res.ms} ms)`);
  console.log("classification:", classify(res));
  if (res.json) {
    console.log("response top-level keys:", Object.keys(res.json));
    console.log("data shape:", JSON.stringify(shape(res.json.data ?? res.json.error ?? res.json), null, 2));
  } else {
    console.log("raw body:", res.text.slice(0, 500));
  }
  const mapped = mapBook(res.json?.data);
  console.log("mapper result:", JSON.stringify(mapped));
  const issues = [];
  if (classify(res) !== "ok") issues.push(`response classified as "${classify(res)}", not a clean 200 with data`);
  if (!mapped.status) issues.push("no string `status` field in data");
  else if (mapped.status.toUpperCase() !== "CONFIRMED") issues.push(`status is "${mapped.status}", mapper only accepts CONFIRMED (anything else is treated as unknown/flagged)`);
  if (!mapped.bookingId) issues.push("no `bookingId` in data");
  if (!mapped.hotelConfirmationCode) issues.push("no `hotelConfirmationCode` (stored as null; not fatal)");
  if (!mapped.supplierBookingId) issues.push("no `supplierBookingId` (stored as null; not fatal)");
  console.log(mapped.confirmed ? "VERDICT: server would mark this CONFIRMED" : "VERDICT: server would NOT mark this confirmed");
  if (issues.length) console.log("things to look at:\n - " + issues.join("\n - "));
  return mapped;
};

console.log(`\nbooking with clientReference ${clientReference} ...`);
const first = await post("https://book.liteapi.travel/v3.0/rates/book", bookBody, 60000);
const firstMapped = report("book (first call)", first);

if (retry) {
  console.log("\nre-sending the SAME clientReference to test idempotency ...");
  const second = await post("https://book.liteapi.travel/v3.0/rates/book", bookBody, 60000);
  const secondMapped = report("book (retry, same clientReference)", second);
  if (firstMapped.bookingId && secondMapped.bookingId) {
    console.log(firstMapped.bookingId === secondMapped.bookingId
      ? "\nIDEMPOTENT: same bookingId returned, a retry would not double-book."
      : "\nNOT IDEMPOTENT: a different bookingId came back. Tell me before relying on retries.");
  } else {
    console.log("\nRetry did not return a bookingId; check the output above (an error here may be fine if it says the reference already exists).");
  }
}

console.log("\nDone. This is a sandbox booking, no real money or hotel reservation is involved.");