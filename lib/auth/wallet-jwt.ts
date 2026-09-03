import {
  SignJWT,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { requireEnv } from "@/lib/supabase/env";

export const WALLET_ACCESS_COOKIE = "wallet_access_token";
export const WALLET_REFRESH_COOKIE = "wallet_refresh_token";
export const WALLET_ADDRESS_HEADER = "x-wallet-address";

const ACCESS_TOKEN_TTL_SEC = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

export const DEFAULT_SIGNATURE_MAX_AGE_SEC = 24 * 60 * 60; // 24 hours

export function getSignatureMaxAgeSec(): number {
  const env = process.env.WALLET_SIGNATURE_MAX_AGE_SECONDS;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_SIGNATURE_MAX_AGE_SEC;
}

export interface WalletAccessClaims extends JWTPayload {
  walletAddress: string;
  type: "access";
  sigVerifiedAt: number;
  sessionId?: string;
}

export interface WalletRefreshClaims extends JWTPayload {
  walletAddress: string;
  type: "refresh";
  jti: string;
  sigVerifiedAt: number;
}

function getJwtSecret(): Uint8Array {
  const secret = requireEnv("WALLET_JWT_SECRET").trim();
  return new TextEncoder().encode(secret);
}

export function getAccessTokenMaxAgeSec(): number {
  return ACCESS_TOKEN_TTL_SEC;
}

export function getRefreshTokenMaxAgeSec(): number {
  return REFRESH_TOKEN_TTL_SEC;
}

export async function signWalletAccessToken(
  walletAddress: string,
  sigVerifiedAt: number,
  sessionId?: string,
): Promise<string> {
  const payload: Record<string, unknown> = { walletAddress, type: "access", sigVerifiedAt };
  if (sessionId) {
    payload.sessionId = sessionId;
  }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SEC}s`)
    .sign(getJwtSecret());
}

export async function signWalletRefreshToken(
  walletAddress: string,
  jti: string,
  sigVerifiedAt: number,
): Promise<string> {
  return new SignJWT({ walletAddress, type: "refresh", jti, sigVerifiedAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SEC}s`)
    .sign(getJwtSecret());
}

export async function verifyWalletAccessToken(
  token: string,
): Promise<WalletAccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.type !== "access" || typeof payload.walletAddress !== "string") {
      return null;
    }
    return payload as WalletAccessClaims;
  } catch {
    return null;
  }
}

export async function verifyWalletRefreshToken(
  token: string,
): Promise<WalletRefreshClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });
    if (
      payload.type !== "refresh" ||
      typeof payload.walletAddress !== "string" ||
      typeof payload.jti !== "string"
    ) {
      return null;
    }
    return payload as WalletRefreshClaims;
  } catch {
    return null;
  }
}

export function createRefreshTokenId(): string {
  return crypto.randomUUID();
}
