interface RateLimitConfig {
  maxMessages: number
  windowMs: number
}

interface MessageRecord {
  timestamps: number[]
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxMessages: 5,
  windowMs: 10000, // 10 seconds
}

class RateLimiter {
  private records = new Map<string, MessageRecord>()
  private config: RateLimitConfig

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  check(walletAddress: string): { allowed: boolean; remainingMs?: number } {
    const now = Date.now()
    const record = this.records.get(walletAddress) || { timestamps: [] }

    // Remove timestamps outside the window
    record.timestamps = record.timestamps.filter(
      (ts) => now - ts < this.config.windowMs
    )

    if (record.timestamps.length >= this.config.maxMessages) {
      const oldestTimestamp = record.timestamps[0]
      const remainingMs = this.config.windowMs - (now - oldestTimestamp)
      return { allowed: false, remainingMs }
    }

    record.timestamps.push(now)
    this.records.set(walletAddress, record)

    return { allowed: true }
  }

  reset(walletAddress: string): void {
    this.records.delete(walletAddress)
  }
}

export const rateLimiter = new RateLimiter()
