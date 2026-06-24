import { Keypair } from "@stellar/stellar-sdk";
import {
  validateStellarAddress,
  validateRequiredFields,
  validateWalletAddressWithMessage,
} from "./validation";

describe("validateStellarAddress", () => {
  it("accepts a valid Stellar public key", () => {
    const address = Keypair.random().publicKey();
    expect(validateStellarAddress(address)).toBe(true);
  });

  it("rejects a string that is too short", () => {
    expect(validateStellarAddress("GABC")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateStellarAddress("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(validateStellarAddress(null)).toBe(false);
    expect(validateStellarAddress(undefined)).toBe(false);
    expect(validateStellarAddress(123)).toBe(false);
  });

  it("rejects a 56-char string that fails checksum", () => {
    // 56 chars starting with G but random content that won't pass StrKey checksum
    expect(validateStellarAddress("G" + "A".repeat(55))).toBe(false);
  });

  it("rejects a private key (starts with S)", () => {
    const secret = Keypair.random().secret();
    expect(validateStellarAddress(secret)).toBe(false);
  });
});

describe("validateRequiredFields", () => {
  it("returns no errors when all fields are present", () => {
    const errors = validateRequiredFields(
      { walletAddress: "GABC", signature: "xyz" },
      ["walletAddress", "signature"]
    );
    expect(errors).toHaveLength(0);
  });

  it("returns an error for each missing field", () => {
    const errors = validateRequiredFields({ walletAddress: "GABC" }, ["walletAddress", "signature"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe("signature");
  });

  it("rejects whitespace-only fields", () => {
    const errors = validateRequiredFields({ walletAddress: "   " }, ["walletAddress"]);
    expect(errors).toHaveLength(1);
  });

  it("returns errors for all missing fields", () => {
    const errors = validateRequiredFields({}, ["walletAddress", "signature"]);
    expect(errors).toHaveLength(2);
  });
});

describe("validateWalletAddressWithMessage", () => {
  it("returns null for a valid address", () => {
    const address = Keypair.random().publicKey();
    expect(validateWalletAddressWithMessage(address)).toBeNull();
  });

  it("returns required message when address is missing", () => {
    expect(validateWalletAddressWithMessage(null)).toBe("walletAddress is required");
    expect(validateWalletAddressWithMessage(undefined)).toBe("walletAddress is required");
    expect(validateWalletAddressWithMessage("")).toBe("walletAddress is required");
  });

  it("returns invalid message for a malformed address", () => {
    expect(validateWalletAddressWithMessage("invalid")).toBe("Invalid Stellar wallet address");
  });
});
