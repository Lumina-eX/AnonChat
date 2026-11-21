import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Redis client module
vi.mock("@/lib/redis", () => ({
  getRedisClient: vi.fn().mockResolvedValue(null),
}));

// Mock the logger module
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createSession,
  validateSession,
  terminateSession,
  terminateAllSessions,
  listSessions,
  cleanupExpiredSessions,
  clearAllSessions,
} from "@/lib/auth/session-store";

describe("Session Store", () => {
  const walletAddress = "GABC1234567890abcdef";

  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAllSessions();
  });

  describe("createSession", () => {
    it("should create a new session and return a sessionId", async () => {
      const sessionId = await createSession({
        walletAddress,
        userAgent: "test-agent",
        ipAddress: "127.0.0.1",
      });

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe("string");
      expect(sessionId.length).toBeGreaterThan(0);
    });

    it("should create unique session IDs for each call", async () => {
      const id1 = await createSession({ walletAddress });
      const id2 = await createSession({ walletAddress });

      expect(id1).not.toBe(id2);
    });
  });

  describe("validateSession", () => {
    it("should return null for a non-existent session", async () => {
      const result = await validateSession("non-existent-id");
      expect(result).toBeNull();
    });

    it("should return session record for a valid session", async () => {
      const sessionId = await createSession({
        walletAddress,
        userAgent: "test-agent",
      });

      const result = await validateSession(sessionId);
      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe(sessionId);
      expect(result?.walletAddress).toBe(walletAddress.toLowerCase());
      expect(result?.userAgent).toBe("test-agent");
    });
  });

  describe("terminateSession", () => {
    it("should return false for a non-existent session", async () => {
      const result = await terminateSession("non-existent-id", walletAddress);
      expect(result).toBe(false);
    });

    it("should terminate an existing session", async () => {
      const sessionId = await createSession({ walletAddress });

      const result = await terminateSession(sessionId, walletAddress);
      expect(result).toBe(true);

      // Verify session is gone
      const validated = await validateSession(sessionId);
      expect(validated).toBeNull();
    });

    it("should not terminate a session belonging to another wallet", async () => {
      const sessionId = await createSession({ walletAddress });

      const result = await terminateSession(sessionId, "GOTHER1234567890abcdef");
      expect(result).toBe(false);

      // Verify session still exists
      const validated = await validateSession(sessionId);
      expect(validated).not.toBeNull();
    });
  });

  describe("terminateAllSessions", () => {
    it("should terminate all sessions for a wallet", async () => {
      await createSession({ walletAddress });
      await createSession({ walletAddress });
      await createSession({ walletAddress });

      const count = await terminateAllSessions(walletAddress);
      expect(count).toBe(3);

      const remaining = await listSessions(walletAddress);
      expect(remaining.length).toBe(0);
    });

    it("should not terminate sessions belonging to other wallets", async () => {
      await createSession({ walletAddress });
      await createSession({ walletAddress: "GOTHER1234567890abcdef" });

      const count = await terminateAllSessions(walletAddress);
      expect(count).toBe(1);

      const otherSessions = await listSessions("GOTHER1234567890abcdef");
      expect(otherSessions.length).toBe(1);
    });

    it("should exclude a specific session when requested", async () => {
      await createSession({ walletAddress });
      const id2 = await createSession({ walletAddress });
      await createSession({ walletAddress });

      const count = await terminateAllSessions(walletAddress, id2);
      expect(count).toBe(2);

      const remaining = await listSessions(walletAddress);
      expect(remaining.length).toBe(1);
      expect(remaining[0].sessionId).toBe(id2);
    });
  });

  describe("listSessions", () => {
    it("should return empty array for wallet with no sessions", async () => {
      const sessions = await listSessions(walletAddress);
      expect(sessions).toEqual([]);
    });

    it("should return all sessions for a wallet", async () => {
      await createSession({ walletAddress, userAgent: "agent-1" });
      await createSession({ walletAddress, userAgent: "agent-2" });

      const sessions = await listSessions(walletAddress);
      expect(sessions.length).toBe(2);
    });

    it("should return sessions sorted by lastActivityAt descending", async () => {
      const id1 = await createSession({ walletAddress, userAgent: "agent-1" });
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      const id2 = await createSession({ walletAddress, userAgent: "agent-2" });

      const sessions = await listSessions(walletAddress);
      expect(sessions.length).toBe(2);
      expect(sessions[0].sessionId).toBe(id2);
      expect(sessions[1].sessionId).toBe(id1);
    });
  });

  describe("cleanupExpiredSessions", () => {
    it("should return 0 when no expired sessions exist", async () => {
      await createSession({ walletAddress });
      const cleaned = await cleanupExpiredSessions();
      expect(cleaned).toBe(0);
    });
  });
});
