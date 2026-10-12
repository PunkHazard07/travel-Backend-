import crypto from "crypto";
import { paystackService } from "../Config/paystackService.js";

describe("verifyWebhookSignature", () => {
  const originalSecretKey = process.env.PAYSTACK_SECRET_KEY;
  const testSecret = "sk_test_fake_secret_for_unit_tests";

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = testSecret;
  });

  afterAll(() => {
    process.env.PAYSTACK_SECRET_KEY = originalSecretKey;
  });

  const signBody = (body: string, secret: string): string =>
    crypto.createHmac("sha512", secret).update(body).digest("hex");

  it("accepts a signature that genuinely matches the raw body", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "ref_123" } });
    const signature = signBody(body, testSecret);
    expect(paystackService.verifyWebhookSignature(Buffer.from(body), signature)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "ref_123" } });
    const signature = signBody(body, "sk_test_wrong_secret");
    expect(paystackService.verifyWebhookSignature(Buffer.from(body), signature)).toBe(false);
  });

  it("rejects when the body was tampered with after signing", () => {
    const originalBody = JSON.stringify({ event: "charge.success", data: { reference: "ref_123", amount: 1000 } });
    const signature = signBody(originalBody, testSecret);
    const tamperedBody = JSON.stringify({ event: "charge.success", data: { reference: "ref_123", amount: 999999 } });
    expect(paystackService.verifyWebhookSignature(Buffer.from(tamperedBody), signature)).toBe(false);
  });

  it("rejects a garbage/malformed signature without throwing", () => {
    const body = JSON.stringify({ event: "charge.success" });
    expect(() =>
      paystackService.verifyWebhookSignature(Buffer.from(body), "not-a-real-signature")
    ).not.toThrow();
    expect(paystackService.verifyWebhookSignature(Buffer.from(body), "not-a-real-signature")).toBe(false);
  });

  it("returns false rather than throwing when PAYSTACK_SECRET_KEY is unset", () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    const body = JSON.stringify({ event: "charge.success" });
    const signature = signBody(body, testSecret);
    expect(() => paystackService.verifyWebhookSignature(Buffer.from(body), signature)).not.toThrow();
    expect(paystackService.verifyWebhookSignature(Buffer.from(body), signature)).toBe(false);
  });
});