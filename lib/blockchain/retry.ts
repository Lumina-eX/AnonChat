/**
 * Exponential backoff retry utility for transient Horizon / network failures.
 *
 * The delay sequence (in ms) for each attempt uses:
 *   base * 2^attempt + random jitter (0–jitter ms)
 *
 * This keeps retries spread out under concurrent load and avoids thundering-herd
 * issues when Horizon recovers from a brief outage.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the initial call). Default 3. */
  maxRetries?: number;
  /** Base delay in milliseconds before the first retry. Default 500. */
  baseDelayMs?: number;
  /** Maximum jitter added to each delay, in milliseconds. Default 200. */
  jitterMs?: number;
  /** Upper cap on the computed delay, in milliseconds. Default 30 000. */
  maxDelayMs?: number;
  /**
   * Predicate that decides whether a thrown error warrants a retry.
   * Return true to retry, false to rethrow immediately.
   * Defaults to retrying all errors.
   */
  isRetryable?: (error: unknown) => boolean;
  /** Called after each failed attempt before the next sleep. Useful for logging. */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export type RetryResult<T> =
  | { success: true; value: T; attempts: number }
  | { success: false; error: unknown; attempts: number };

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  jitterMs: number,
  maxDelayMs: number,
): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * jitterMs;
  return Math.min(exponential + jitter, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes `fn` with exponential backoff retries on failure.
 *
 * Returns a discriminated union so callers can decide how to handle
 * exhausted retries without relying on exceptions.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    jitterMs = 200,
    maxDelayMs = 30_000,
    isRetryable = () => true,
    onRetry,
  } = options;

  let lastError: unknown;
  let attempt = 0; // 0 = first call, 1..maxRetries = retries

  while (attempt <= maxRetries) {
    try {
      const value = await fn();
      return { success: true, value, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;

      if (!isRetryable(error)) {
        return { success: false, error, attempts: attempt + 1 };
      }

      if (attempt >= maxRetries) {
        break;
      }

      const delayMs = computeDelay(attempt, baseDelayMs, jitterMs, maxDelayMs);
      onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
      attempt++;
    }
  }

  return { success: false, error: lastError, attempts: attempt + 1 };
}

/**
 * Returns true when the error looks like a transient Horizon or network failure
 * (timeout, connection reset, 429 Too Many Requests, 503 Service Unavailable).
 *
 * Non-retryable examples: 404 Not Found, validation errors, bad hashes.
 */
export function isHorizonRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return true; // unknown shape — be cautious and retry

  const msg = error.message.toLowerCase();

  // Explicit non-retryable: resource not found
  if (msg.includes("not found") || msg.includes("404")) return false;

  // Explicit non-retryable: bad request / validation
  if (msg.includes("bad request") || msg.includes("400")) return false;

  // Explicit non-retryable: unauthorized / forbidden
  if (
    msg.includes("unauthorized") ||
    msg.includes("401") ||
    msg.includes("403")
  )
    return false;

  // Retryable: timeout, rate limit, service unavailable, connection issues
  if (
    msg.includes("timeout") ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("service unavailable")
  )
    return true;

  // Default: retry unknown errors
  return true;
}
