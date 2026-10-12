import { prebookRate, bookRate, classifyHttpStatus, LiteApiError } from "../Config/liteBooking.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.LITE_KEY;

let lastUrl = "";
let lastInit: any = null;

const mockFetch = (status: number, body: unknown) => {
  globalThis.fetch = (async (url: any, init: any) => {
    lastUrl = String(url);
    lastInit = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
};

beforeEach(() => {
  process.env.LITE_KEY = "test-key";
  lastUrl = "";
  lastInit = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.LITE_KEY;
  else process.env.LITE_KEY = originalKey;
});

describe("classifyHttpStatus", () => {
  it("treats client errors as definitive rejections", () => {
    for (const s of [400, 401, 403, 404, 422]) expect(classifyHttpStatus(s)).toBe("rejected");
  });
  it("treats timeouts, rate limits and server errors as unknown", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(classifyHttpStatus(s)).toBe("unknown");
  });
});

describe("prebookRate", () => {
  it("returns the data payload", async () => {
    mockFetch(200, { data: { prebookId: "pb-1", price: 1000 } });
    await expect(prebookRate("offer-1")).resolves.toEqual({ prebookId: "pb-1", price: 1000 });
  });

  it("posts the offerId to the prebook endpoint with the api key", async () => {
    mockFetch(200, { data: { prebookId: "pb-1" } });
    await prebookRate("offer-1");
    expect(lastUrl).toBe("https://book.liteapi.travel/v3.0/rates/prebook");
    expect(lastInit.method).toBe("POST");
    expect(lastInit.headers["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(lastInit.body)).toEqual({ offerId: "offer-1", usePaymentSdk: false });
  });

  it("maps a 400 to a rejected error carrying LiteAPI's message", async () => {
    mockFetch(400, { error: { message: "invalid offerId" } });
    await expect(prebookRate("bad")).rejects.toMatchObject({ kind: "rejected", status: 400, message: "invalid offerId" });
  });

  it("maps a 500 to an unknown-outcome error", async () => {
    mockFetch(500, "boom");
    await expect(prebookRate("x")).rejects.toMatchObject({ kind: "unknown", status: 500 });
  });

  it("maps a network failure to an unknown-outcome error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;
    await expect(prebookRate("x")).rejects.toMatchObject({ kind: "unknown" });
  });

  it("treats a 200 carrying an error and no data as a rejection", async () => {
    mockFetch(200, { error: { message: "sold out" } });
    await expect(prebookRate("x")).rejects.toMatchObject({ kind: "rejected", message: "sold out" });
  });

  it("treats an empty 200 as unknown", async () => {
    mockFetch(200, "");
    await expect(prebookRate("x")).rejects.toMatchObject({ kind: "unknown" });
  });

  it("rejects without calling the network when LITE_KEY is missing", async () => {
    delete process.env.LITE_KEY;
    mockFetch(200, { data: {} });
    await expect(prebookRate("x")).rejects.toBeInstanceOf(LiteApiError);
    expect(lastUrl).toBe("");
  });
});

describe("bookRate", () => {
  const body = {
    prebookId: "pb-1",
    holder: { firstName: "Ada", lastName: "Obi", email: "ada@example.com" },
    guests: [{ occupancyNumber: 1, firstName: "Ada", lastName: "Obi" }],
    payment: { method: "ACC_CREDIT_CARD" },
    clientReference: "BK-ABC1234567",
  };

  it("posts the booking with its idempotency reference", async () => {
    mockFetch(200, { data: { bookingId: "b-1", status: "CONFIRMED" } });
    const data = await bookRate(body);
    expect(data).toEqual({ bookingId: "b-1", status: "CONFIRMED" });
    expect(lastUrl).toBe("https://book.liteapi.travel/v3.0/rates/book");
    expect(JSON.parse(lastInit.body).clientReference).toBe("BK-ABC1234567");
    expect(JSON.parse(lastInit.body).payment).toEqual({ method: "ACC_CREDIT_CARD" });
  });

  it("reports a refused booking as rejected", async () => {
    mockFetch(422, { error: { message: "prebook expired" } });
    await expect(bookRate(body)).rejects.toMatchObject({ kind: "rejected", status: 422 });
  });

  it("reports a timeout status as unknown, not failed", async () => {
    mockFetch(408, { error: { message: "timeout" } });
    await expect(bookRate(body)).rejects.toMatchObject({ kind: "unknown", status: 408 });
  });
});