type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const ACTIVE_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";

const SENSITIVE_KEYS = new Set([
  "ip",
  "ipaddress",
  "ip_address",
  "x-forwarded-for",
  "x-real-ip",
  "content",
  "message",
  "text",
  "body",
  "payload",
  "metadata",
  "headers",
  "cookies",
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "authorization",
  "email",
  "phone",
  "address",
  "location",
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MaxDepth]";
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key.toLowerCase())
      ? "[REDACTED]"
      : sanitize(val, depth + 1);
  }
  return result;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[ACTIVE_LEVEL];
}

function emit(
  level: LogLevel,
  event: string,
  context?: Record<string, unknown>,
  correlationId?: string,
): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(correlationId !== undefined && { correlationId }),
    ...(context !== undefined && {
      context: sanitize(context) as Record<string, unknown>,
    }),
  };

  const line = JSON.stringify(entry);

  switch (level) {
    case "debug":
    case "info":
      console.log(`[${level.toUpperCase()}]`, line);
      break;
    case "warn":
      console.warn(`[WARN]`, line);
      break;
    case "error":
      console.error(`[ERROR]`, line);
      break;
  }
}

export const logger = {
  debug(
    event: string,
    context?: Record<string, unknown>,
    correlationId?: string,
  ) {
    emit("debug", event, context, correlationId);
  },
  info(
    event: string,
    context?: Record<string, unknown>,
    correlationId?: string,
  ) {
    emit("info", event, context, correlationId);
  },
  warn(
    event: string,
    context?: Record<string, unknown>,
    correlationId?: string,
  ) {
    emit("warn", event, context, correlationId);
  },
  error(
    event: string,
    context?: Record<string, unknown>,
    correlationId?: string,
  ) {
    emit("error", event, context, correlationId);
  },
};
