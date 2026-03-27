
// Polyfill for randomUUID for environments where crypto.randomUUID is not available
function getRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for Node.js or environments without crypto.randomUUID
  // RFC4122 version 4 compliant UUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  eventType: string;
  userId?: string;
  // Add other non-sensitive fields as needed
  [key: string]: any;
}

export interface SystemLog {
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId: string;
  context: LogContext;
}

/**
 * Generates a unique correlation ID for tracing operations
 */
export function generateCorrelationId(): string {
  return getRandomUUID();
}

/**
 * Filters out sensitive fields from context
 */
function filterSensitiveData(context: LogContext): LogContext {
  const { ip, ipAddress, message, content, metadata, ...safeContext } = context;
  // Ensure eventType is preserved
  if (!safeContext.eventType && context.eventType) {
    safeContext.eventType = context.eventType;
  }
  return safeContext as LogContext;
}

/**
 * Logs system events with structured format, excluding sensitive data
 * @param level - Log level (info, warn, error)
 * @param event - Event name/description
 * @param context - Additional context data (non-sensitive)
 * @param correlationId - Optional correlation ID for tracing
 */
export function logSystemEvent(
  level: LogLevel,
  event: string,
  context: LogContext,
  correlationId?: string
): void {
  const safeContext = filterSensitiveData(context);
  const log: SystemLog = {
    timestamp: new Date().toISOString(),
    level,
    event,
    correlationId: correlationId || generateCorrelationId(),
    context: safeContext,
  };

  const logMessage = `[System ${level.toUpperCase()}] ${event}`;
  const logData = JSON.stringify(log);

  switch (level) {
    case "info":
      console.log(logMessage, logData);
      break;
    case "warn":
      console.warn(logMessage, logData);
      break;
    case "error":
      console.error(logMessage, logData);
      break;
  }
}

// Example centralized logging integration (stub)
export function sendToCentralizedLogging(log: SystemLog) {
  // Integrate with external logging service here
  // e.g., send log to Datadog, Sentry, Loggly, etc.
}

/**
 * Logging Usage & Guidelines
 *
 * 1. Use logSystemEvent for all system and application event logging.
 * 2. Do NOT log sensitive data (IP addresses, message content, metadata, user secrets, etc).
 * 3. Always use standardized event names (eventType) and context keys for consistency.
 * 4. Set log level appropriately: info (normal ops), warn (unexpected but non-fatal), error (failures).
 * 5. For new event types, extend LogContext as needed, but never include sensitive fields.
 * 6. Integrate sendToCentralizedLogging for production deployments (e.g., Datadog, Sentry, Loggly).
 * 7. All logs are structured JSON for easy parsing and monitoring.
 * 8. This logging utility is scalable for future event types—add new eventType values as needed.
 * 9. Review privacy and security guidelines before adding new log fields.
 *
 * Example:
 *   logSystemEvent("info", "user_authenticated", { eventType: "user_authenticated", userId })
 *
 * For more, see SECURITY.md or contact the security team.
 */
