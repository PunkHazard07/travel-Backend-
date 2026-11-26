import { listBookingsByClientReference, isDuplicateClientReference, LiteApiError } from "../Config/liteBooking.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.LITE_KEY;

let lastUrl = "";
let lastInit: any = null;

const stubFetch = (status: number, body: unknown) => {
  globalThis.fetch = (async (url: any, init: any) => {
    lastUrl = String(url);
    lastInit = init;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (body === undefined ? "" : JSON.stringify(body)),
    } as Response;
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

describe("listBookingsByClientReference", () => {
  it("sends a GET with the api key and the encoded reference, and no body", async () => {
    stubFetch(200, { data: [] });

    await listBookingsByClientReference("BK-ABC 123&x=1");

    expect(lastUrl).toBe("https://book.liteapi.travel/v3.0/bookings?clientReference=BK-ABC%20123%26x%3D1");
    expect(lastInit.method).toBe("GET");
    expect(lastInit.headers["X-API-Key"]).toBe("test-key");
    expect(lastInit.body).toBeUndefined();
  });

  it("returns the list when a booking matches", async () => {
    stubFetch(200, { data: [{ bookingId: "xEB7DKLZ7", clientReference: "BK-1", status: "CONFIRMED" }] });

    await expect(listBookingsByClientReference("BK-1")).resolves.toEqual([{ bookingId: "xEB7DKLZ7", clientReference: "BK-1", status: "CONFIRMED" }]);
  });

  it("returns an empty list when nothing matches (HTTP 200 with data: [])", async () => {
    stubFetch(200, { data: [] });

    await expect(listBookingsByClientReference("BK-NONE")).resolves.toEqual([]);
  });

  it("reports a server error as an unknown-outcome error", async () => {
    stubFetch(503, { error: { message: "unavailable" } });

    await expect(listBookingsByClientReference("BK-1")).rejects.toMatchObject({ kind: "unknown", status: 503 });
  });

  it("reports a network failure as an unknown-outcome error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("socket hang up");
    }) as typeof fetch;

    await expect(listBookingsByClientReference("BK-1")).rejects.toMatchObject({ kind: "unknown" });
  });

  it("does not call the network when LITE_KEY is missing", async () => {
    delete process.env.LITE_KEY;
    stubFetch(200, { data: [] });

    await expect(listBookingsByClientReference("BK-1")).rejects.toBeInstanceOf(LiteApiError);
    expect(lastUrl).toBe("");
  });
});

describe("isDuplicateClientReference", () => {
  it("recognises LiteAPI error 4005", () => {
    const error = new LiteApiError("duplicate booking attempt with existing client reference", "rejected", 400, {
      error: { code: 4005, message: "duplicate booking attempt with existing client reference" },
    });

    expect(isDuplicateClientReference(error)).toBe(true);
  });

  it("does not match other LiteAPI errors or other error types", () => {
    expect(isDuplicateClientReference(new LiteApiError("bad", "rejected", 400, { error: { code: 4001 } }))).toBe(false);
    expect(isDuplicateClientReference(new LiteApiError("bad", "rejected", 400, null))).toBe(false);
    expect(isDuplicateClientReference(new Error("4005"))).toBe(false);
    expect(isDuplicateClientReference(undefined)).toBe(false);
  });

  it("is produced end to end by a real 400 carrying code 4005", async () => {
    stubFetch(400, { error: { code: 4005, message: "duplicate booking attempt with existing client reference" } });

    const error = await listBookingsByClientReference("BK-1").catch((e) => e);

    expect(isDuplicateClientReference(error)).toBe(true);
  });
});