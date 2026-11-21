import { getRedisClient } from "@/lib/redis";
import { randomBytes } from "crypto";

const ADJECTIVES = [
  "Silent", "Hidden", "Secret", "Shadow", "Ghost", "Phantom", "Mystic",
  "Veiled", "Cosmic", "Neon", "Crimson", "Azure", "Golden", "Silver",
  "Onyx", "Jade", "Crystal", "Lunar", "Solar", "Stellar"
];

const NOUNS = [
  "Panda", "Fox", "Eagle", "Dolphin", "Tiger", "Wolf", "Owl", "Raven",
  "Dragon", "Phoenix", "Leopard", "Falcon", "Panther", "Lion", "Bear",
  "Hawk", "Shark", "Orca", "Cobra", "Viper"
];

/**
 * Generates a random alias string (e.g., "SilentPanda-1a2b").
 */
export function generateRandomAlias(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const hash = randomBytes(2).toString("hex");
  return `${adj}${noun}-${hash}`;
}

/**
 * Gets or creates a unique random alias for a user in a specific room.
 * The alias is stored in Redis to persist for the session (24 hours).
 */
export async function getOrCreateUserAlias(roomId: string, userId: string): Promise<string> {
  const redis = await getRedisClient();
  
  if (!redis) {
    // Fallback if Redis is not available
    const hash = randomBytes(4).toString("hex");
    return `Anon-${hash}`;
  }

  const aliasKey = `room:${roomId}:user:${userId}:alias`;
  const existingAlias = await redis.get(aliasKey);
  
  if (existingAlias) {
    // Refresh expiration on access
    await redis.expire(aliasKey, 60 * 60 * 24);
    return existingAlias;
  }

  let newAlias = "";
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    newAlias = generateRandomAlias();
    const uniqueKey = `room:${roomId}:alias:${newAlias}`;
    
    // SETNX returns true if the key didn't exist and was set successfully
    const setSuccess = await redis.setNX(uniqueKey, userId);
    
    if (setSuccess) {
      // Set expiration for uniqueness constraint
      await redis.expire(uniqueKey, 60 * 60 * 24);
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    // Fallback if uniqueness cannot be guaranteed after max attempts
    newAlias = `Anon-${randomBytes(4).toString("hex")}`;
  }

  // Store the user's alias mapping
  await redis.setEx(aliasKey, 60 * 60 * 24, newAlias);
  
  return newAlias;
}
