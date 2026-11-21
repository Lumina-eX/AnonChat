import { describe, it, expect } from "vitest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { isValidStellarAddress, getStellarAddressError } from "./stellar-address";

// A real valid Stellar public key (from a random keypair)
const VALID_ADDRESS = StellarSdk.Keypair.random().publicKey();

describe("isValidStellarAddress", () => {
  it("accepts a real Stellar public key", () => {
    expect(isValidStellarAddress(VALID_ADDRESS)).toBe(true);
  });

  it("rejects an address with wrong length", () => {
    expect(isValidStellarAddress("GABC123")).toBe(false);
  });

  it("rejects an address that does not start with G", () => {
    // Replace leading 'G' with 'A'
    const bad = "A" + VALID_ADDRESS.slice(1);
    expect(isValidStellarAddress(bad)).toBe(false);
  });

  it("rejects an address with a bad checksum", () => {
    // Flip the last character
    const last = VALID_ADDRESS[VALID_ADDRESS.length - 1];
    const flipped = last === "A" ? "B" : "A";
    expect(isValidStellarAddress(VALID_ADDRESS.slice(0, -1) + flipped)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidStellarAddress(null)).toBe(false);
    expect(isValidStellarAddress(undefined)).toBe(false);
    expect(isValidStellarAddress(123)).toBe(false);
    expect(isValidStellarAddress({})).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(isValidStellarAddress("   ")).toBe(false);
  });

  it("rejects an address with invalid base32 characters", () => {
    expect(isValidStellarAddress("G" + "0".repeat(55))).toBe(false);
  });
});

describe("getStellarAddressError", () => {
  it("returns null for a valid address", () => {
    expect(getStellarAddressError(VALID_ADDRESS)).toBeNull();
  });

  it("returns required message for empty string", () => {
    expect(getStellarAddressError("")).toBe("Stellar address is required");
  });

  it("returns required message for non-string", () => {
    expect(getStellarAddressError(null)).toBe("Stellar address is required");
    expect(getStellarAddressError(undefined)).toBe("Stellar address is required");
  });

  it("returns invalid message for a malformed address", () => {
    expect(getStellarAddressError("GABC123")).toBe("Invalid Stellar address");
  });

  it("returns invalid message for wrong-length address starting with G", () => {
    expect(getStellarAddressError("G" + "A".repeat(54))).toBe("Invalid Stellar address");
  });
});
