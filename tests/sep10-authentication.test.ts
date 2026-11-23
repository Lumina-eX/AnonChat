import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "crypto";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  buildSep10Challenge,
  checkSep10RateLimit,
  clearSep10State,
  consumeSep10Challenge,
  loadSep10Config,
  Sep10Error,
  verifySep10Challenge,
} from "@/lib/auth/sep10";

const serverKeypair = StellarSdk.Keypair.random();
const clientKeypair = StellarSdk.Keypair.random();
const otherKeypair = StellarSdk.Keypair.random();

const TESTNET = StellarSdk.Networks.TESTNET;

function signChallenge(
  transaction: string,
  signer: StellarSdk.Keypair,
): string {
  const tx = StellarSdk.TransactionBuilder.fromXDR(
    transaction,
    TESTNET,
  ) as StellarSdk.Transaction;
  tx.sign(signer);
  return tx.toEnvelope().toXDR("base64");
}

describe("SEP-10 authentication", () => {
  beforeEach(() => {
    process.env.SEP10_SERVER_SECRET = serverKeypair.secret();
    process.env.SEP10_HOME_DOMAIN = "anonchat.test";
    process.env.SEP10_WEB_AUTH_DOMAIN = "anonchat.test";
    process.env.SEP10_NETWORK_PASSPHRASE = TESTNET;
    process.env.SEP10_CHALLENGE_TTL_SECONDS = "300";
    delete process.env.REDIS_URL;
    clearSep10State();
  });

  afterEach(() => {
    delete process.env.SEP10_SERVER_SECRET;
    delete process.env.SEP10_HOME_DOMAIN;
    delete process.env.SEP10_WEB_AUTH_DOMAIN;
    delete process.env.SEP10_NETWORK_PASSPHRASE;
    delete process.env.SEP10_CHALLENGE_TTL_SECONDS;
    delete process.env.SEP10_RATE_LIMIT;
    delete process.env.SEP10_RATE_WINDOW_SECONDS;
    clearSep10State();
  });

  it("reports missing configuration when no server secret is set", () => {
    delete process.env.SEP10_SERVER_SECRET;
    expect(loadSep10Config()).toBeNull();
  });

  it("builds a challenge that the wallet can sign and the server can verify", () => {
    const account = clientKeypair.publicKey();
    const challenge = buildSep10Challenge(account);
    const signed = signChallenge(challenge.transaction, clientKeypair);

    const result = verifySep10Challenge(signed, account);

    expect(result.walletAddress).toBe(account);
    expect(result.transactionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.networkPassphrase).toBe(TESTNET);
  });

  it("rejects a challenge signed by a different wallet", () => {
    const account = clientKeypair.publicKey();
    const challenge = buildSep10Challenge(account);
    const signed = signChallenge(challenge.transaction, otherKeypair);

    expect(() => verifySep10Challenge(signed, account)).toThrow(Sep10Error);
  });

  it("rejects a valid challenge when the expected account does not match", () => {
    const account = clientKeypair.publicKey();
    const challenge = buildSep10Challenge(account);
    const signed = signChallenge(challenge.transaction, clientKeypair);

    expect(() =>
      verifySep10Challenge(signed, otherKeypair.publicKey()),
    ).toThrow(/expected account/i);
  });

  it("rejects a tampered challenge transaction", () => {
    const account = clientKeypair.publicKey();
    const challenge = buildSep10Challenge(account);
    const signed = signChallenge(challenge.transaction, clientKeypair);

    const tampered = `${signed.slice(0, 20)}AAAA${signed.slice(24)}`;
    expect(() => verifySep10Challenge(tampered, account)).toThrow(Sep10Error);
  });

  it("rejects a challenge built for a different network passphrase", () => {
    process.env.SEP10_NETWORK_PASSPHRASE = StellarSdk.Networks.PUBLIC;
    const account = clientKeypair.publicKey();
    const challenge = buildSep10Challenge(account);

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      challenge.transaction,
      StellarSdk.Networks.PUBLIC,
    ) as StellarSdk.Transaction;
    tx.sign(clientKeypair);
    const signed = tx.toEnvelope().toXDR("base64");

    process.env.SEP10_NETWORK_PASSPHRASE = TESTNET;
    expect(() => verifySep10Challenge(signed, account)).toThrow(Sep10Error);
  });

  it("rejects an expired challenge transaction", () => {
    const account = clientKeypair.publicKey();
    const nowSec = Math.floor(Date.now() / 1000);

    const tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(serverKeypair.publicKey(), "-1"),
      {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: TESTNET,
        timebounds: { minTime: nowSec - 1_000, maxTime: nowSec - 400 },
      },
    )
      .addOperation(
        StellarSdk.Operation.manageData({
          name: "anonchat.test auth",
          value: randomBytes(48).toString("base64"),
          source: account,
        }),
      )
      .addOperation(
        StellarSdk.Operation.manageData({
          name: "web_auth_domain",
          value: "anonchat.test",
          source: serverKeypair.publicKey(),
        }),
      )
      .build();

    tx.sign(serverKeypair, clientKeypair);
    const signed = tx.toEnvelope().toXDR("base64");

    expect(() => verifySep10Challenge(signed, account)).toThrow(Sep10Error);
  });

  it("consumes a challenge hash only once", async () => {
    const hash = "a".repeat(64);
    await expect(consumeSep10Challenge(hash, 300)).resolves.toBe(true);
    await expect(consumeSep10Challenge(hash, 300)).resolves.toBe(false);
  });

  it("enforces the configured authentication rate limit", async () => {
    process.env.SEP10_RATE_LIMIT = "2";
    const policy = { limit: 2, windowSec: 60 };

    await expect(checkSep10RateLimit("ip:1.2.3.4", policy)).resolves.toBe(true);
    await expect(checkSep10RateLimit("ip:1.2.3.4", policy)).resolves.toBe(true);
    await expect(checkSep10RateLimit("ip:1.2.3.4", policy)).resolves.toBe(false);
    await expect(checkSep10RateLimit("ip:5.6.7.8", policy)).resolves.toBe(true);
  });
});
