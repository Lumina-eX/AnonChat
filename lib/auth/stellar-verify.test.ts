/**
 * Unit tests for stellar-verify.ts
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  generateNonce,
  consumeNonce,
  verifyWalletSignature,
} from "./stellar-verify";

// Redis is not available in unit tests; mock the module so the
// functions fall back to the in-memory nonce store.
jest.mock("@/lib/redis", () => ({
  getRedisClient: jest.fn().mockResolvedValue(null),
}));

describe("verifyWalletSignature", () => {
  it("verifies a valid signature", () => {
    const keypair = StellarSdk.Keypair.random();
    const message = "test-nonce-123";
    const signature = keypair.sign(Buffer.from(message, "utf-8")).toString("hex");

    expect(verifyWalletSignature(keypair.publicKey(), message, signature)).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const keypair = StellarSdk.Keypair.random();
    expect(
      verifyWalletSignature(keypair.publicKey(), "test-nonce-123", "0".repeat(128))
    ).toBe(false);
  });

  it("rejects a signature from a different key", () => {
    const kp1 = StellarSdk.Keypair.random();
    const kp2 = StellarSdk.Keypair.random();
    const message = "test-nonce-123";
    const signature = kp1.sign(Buffer.from(message, "utf-8")).toString("hex");

    expect(verifyWalletSignature(kp2.publicKey(), message, signature)).toBe(false);
  });

  it("handles malformed wallet address", () => {
    expect(verifyWalletSignature("invalid-wallet", "msg", "0".repeat(128))).toBe(false);
  });

  it("handles malformed signature hex", () => {
    const keypair = StellarSdk.Keypair.random();
    expect(verifyWalletSignature(keypair.publicKey(), "msg", "not-valid-hex")).toBe(false);
  });

  it("encodes message as UTF-8", () => {
    const keypair = StellarSdk.Keypair.random();
    const message = "Hello 世界 🌍";
    const signature = keypair.sign(Buffer.from(message, "utf-8")).toString("hex");

    expect(verifyWalletSignature(keypair.publicKey(), message, signature)).toBe(true);
  });
});

describe("generateNonce", () => {
  it("generates a nonce with correct format", async () => {
    const nonce = await generateNonce("GABC123");
    expect(nonce).toMatch(/^anonchat:\d+:[a-f0-9-]+$/);
  });

  it("generates unique nonces", async () => {
    const [n1, n2] = await Promise.all([
      generateNonce("GABC123"),
      generateNonce("GABC456"),
    ]);
    expect(n1).not.toBe(n2);
  });
});

describe("consumeNonce", () => {
  it("consumes a valid nonce", async () => {
    const wallet = "GTEST_CONSUME_" + Date.now();
    const nonce = await generateNonce(wallet);
    const consumed = await consumeNonce(wallet);
    expect(consumed).toBe(nonce);
  });

  it("returns null for a non-existent wallet", async () => {
    const consumed = await consumeNonce("GNONEXISTENT_" + Date.now());
    expect(consumed).toBeNull();
  });

  it("only allows one-time use", async () => {
    const wallet = "GTEST_ONETIME_" + Date.now();
    await generateNonce(wallet);

    const first = await consumeNonce(wallet);
    expect(first).not.toBeNull();

    const second = await consumeNonce(wallet);
    expect(second).toBeNull();
  });
});
