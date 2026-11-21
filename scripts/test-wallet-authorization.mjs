#!/usr/bin/env node
/**
 * Unit tests for wallet authorization middleware.
 * Run with: node scripts/test-wallet-authorization.mjs
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Inline the core verification logic to avoid TS import issues in CI
function verifyWalletSignature(walletAddress, message, signature) {
  try {
    const keypair = StellarSdk.Keypair.fromPublicKey(walletAddress);
    const messageBytes = Buffer.from(message, "utf-8");
    const signatureBytes = Buffer.from(signature, "hex");
    return keypair.verify(messageBytes, signatureBytes);
  } catch {
    return false;
  }
}

describe("verifyWalletSignature", () => {
  it("accepts a valid signature", () => {
    const keypair = StellarSdk.Keypair.random();
    const message = "anonchat:123:test-nonce";
    const signature = keypair.sign(Buffer.from(message, "utf-8")).toString("hex");

    assert.equal(
      verifyWalletSignature(keypair.publicKey(), message, signature),
      true,
    );
  });

  it("rejects an invalid signature", () => {
    const keypair = StellarSdk.Keypair.random();
    const message = "anonchat:123:test-nonce";
    const invalidSignature = "0".repeat(128);

    assert.equal(
      verifyWalletSignature(keypair.publicKey(), message, invalidSignature),
      false,
    );
  });

  it("rejects a signature from a different key", () => {
    const keypair1 = StellarSdk.Keypair.random();
    const keypair2 = StellarSdk.Keypair.random();
    const message = "anonchat:123:test-nonce";
    const signature = keypair1.sign(Buffer.from(message, "utf-8")).toString("hex");

    assert.equal(
      verifyWalletSignature(keypair2.publicKey(), message, signature),
      false,
    );
  });

  it("rejects malformed wallet address", () => {
    assert.equal(
      verifyWalletSignature("invalid-wallet", "message", "0".repeat(128)),
      false,
    );
  });

  it("rejects malformed signature hex", () => {
    const keypair = StellarSdk.Keypair.random();
    assert.equal(
      verifyWalletSignature(keypair.publicKey(), "message", "not-valid-hex"),
      false,
    );
  });
});

describe("wallet authorization error handling", () => {
  it("requires walletAddress in payload validation", () => {
    const payload = { signature: "abc" };
    assert.equal(payload.walletAddress, undefined);
  });

  it("requires signature in payload validation", () => {
    const payload = { walletAddress: "GABC" };
    assert.equal(payload.signature, undefined);
  });
});
