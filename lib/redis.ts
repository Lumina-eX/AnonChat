import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

const redisGlobal = globalThis as typeof globalThis & {
  __redisClient?: RedisClient | null;
};

/**
 * Returns a singleton Redis client instance.
 * Connects to REDIS_URL if provided, otherwise returns null.
 */
export async function getRedisClient(): Promise<RedisClient | null> {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;

  if (redisGlobal.__redisClient === undefined) {
    try {
      const client = createClient({ url });
      client.on("error", (err: Error) => {
        console.error("[redis] Client error:", err);
      });
      await client.connect();
      redisGlobal.__redisClient = client;
      console.log("[redis] Connected successfully");
    } catch (e) {
      console.error("[redis] Connection failed:", e);
      redisGlobal.__redisClient = null;
    }
  }

  return redisGlobal.__redisClient ?? null;
}
