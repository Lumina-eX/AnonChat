import { getRedisClient } from "@/lib/redis";
import { getRefreshTokenMaxAgeSec } from "@/lib/auth/wallet-jwt";

const memoryRefreshTokens = new Map<
  string,
  { walletAddress: string; expiresAt: number }
>();

function refreshKey(jti: string): string {
  return `wallet_refresh:${jti}`;
}

/** Stores a refresh token id bound to a wallet until consumed or expired. */
export async function storeRefreshToken(
  jti: string,
  walletAddress: string,
): Promise<void> {
  const ttlSec = getRefreshTokenMaxAgeSec();
  const redis = await getRedisClient();

  if (redis) {
    await redis.set(refreshKey(jti), walletAddress, { EX: ttlSec });
    return;
  }

  memoryRefreshTokens.set(jti, {
    walletAddress,
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

/**
 * Validates and consumes a refresh token id (one-time rotation).
 * Returns the wallet address if valid, otherwise null.
 */
export async function consumeRefreshToken(
  jti: string,
  expectedWalletAddress: string,
): Promise<boolean> {
  const redis = await getRedisClient();

  if (redis) {
    const key = refreshKey(jti);
    const storedWallet = await redis.get(key);
    if (!storedWallet || storedWallet !== expectedWalletAddress) {
      return false;
    }
    await redis.del(key);
    return true;
  }

  const entry = memoryRefreshTokens.get(jti);
  if (!entry) return false;
  memoryRefreshTokens.delete(jti);
  if (Date.now() > entry.expiresAt) return false;
  return entry.walletAddress === expectedWalletAddress;
}
