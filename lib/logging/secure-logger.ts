/**
 * Secure Logging System
 * 
 * A privacy-compliant logging system that records system events without storing sensitive information.
 * Addresses GitHub Issue #94: Logging Without Storing Sensitive Data
 * 
 * Features:
 * - Configurable logging levels (debug, info, warn, error)
 * - Automatic sensitive data redaction
 * - Centralized logging service integration
 * - Standardized log formats
 * - Privacy compliance validation
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogError {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
}

export interface LogContext {
  readonly userId?: string;
  readonly roomId?: string;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly duration?: number;
  readonly error?: LogError;
  readonly [key: string]: unknown;
}

export interface RemoteLoggingConfig {
  readonly endpoint: string;
  readonly apiKey?: string;
  readonly batchSize?: number;
  readonly flushInterval?: number;
  readonly retryAttempts?: number;
}

export interface StandardLogFormat {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly correlationId: string;
  readonly service: string;
  readonly version: string;
  readonly context: LogContext;
  readonly sanitized: boolean;
}

export interface LoggerConfig {
  readonly level: LogLevel;
  readonly enableConsoleOutput: boolean;
  readonly enableFileOutput: boolean;
  readonly enableRemoteLogging: boolean;
  readonly remoteEndpoint?: string;
  readonly remoteConfig?: RemoteLoggingConfig;
  readonly sensitiveFields: readonly string[];
  readonly redactionChar: string;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly enableSanitization: boolean;
  readonly maxLogSize?: number;
}

/**
 * Default sensitive fields that should be redacted from logs
 * Enhanced for privacy compliance with issue #94 requirements
 */
const DEFAULT_SENSITIVE_FIELDS = [
  // Authentication & Security
  "password",
  "token",
  "secret",
  "key",
  "auth",
  "cookie",
  "session",
  "authorization",
  "signature",
  "hash",
  "salt",
  "nonce",
  "private",
  
  // Personal Identifiable Information
  "address",
  "ip",
  "email",
  "phone",
  "userid",
  "username",
  "name",
  
  // Message Content (Privacy Requirement)
  "content",
  "message",
  "text",
  "body",
  "conversation",
  "chat",
  
  // Metadata (Privacy Requirement)
  "data",
  "payload",
  "metadata",
  "info",
  "details",
  
  // Blockchain/Crypto Specific
  "wallet",
  "stellar",
  "mnemonic",
  "seed",
  "passphrase",
  "privatekey",
  "publickey",
  
  // Network & Location
  "location",
  "geo",
  "coordinates",
  "useragent",
  "fingerprint"
] as const;

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: "info",
  enableConsoleOutput: true,
  enableFileOutput: false,
  enableRemoteLogging: false,
  sensitiveFields: DEFAULT_SENSITIVE_FIELDS,
  redactionChar: "*",
  serviceName: "anonchat",
  serviceVersion: "1.0.0",
  enableSanitization: true,
  maxLogSize: 10000
} as const;

/**
 * Generates a unique correlation ID for tracing operations
 */
export function generateCorrelationId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Secure Logger class that provides centralized logging with sensitive data filtering
 * Enhanced for issue #94: Privacy-compliant logging with centralized service integration
 */
export class SecureLogger {
  private readonly config: LoggerConfig;
  private static instance: SecureLogger;
  private logBatch: readonly StandardLogFormat[] = [];
  private batchTimer?: number;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeBatchProcessing();
  }

  /**
   * Get singleton instance of the logger
   */
  static getInstance(config?: Partial<LoggerConfig>): SecureLogger {
    if (!SecureLogger.instance) {
      SecureLogger.instance = new SecureLogger(config);
    }
    return SecureLogger.instance;
  }

  /**
   * Update logger configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Initialize batch processing for remote logging
   */
  private initializeBatchProcessing(): void {
    if (this.config.enableRemoteLogging && this.config.remoteConfig) {
      const interval = this.config.remoteConfig.flushInterval ?? 5000;
      this.batchTimer = window.setInterval(() => {
        void this.flushLogBatch();
      }, interval);
    }
  }

  /**
   * Generate correlation ID for tracing
   */
  generateCorrelationId(): string {
    return generateCorrelationId();
  }

  /**
   * Check if a field name matches sensitive patterns
   */
  private isSensitiveField(fieldName: string): boolean {
    const lowerFieldName = fieldName.toLowerCase();
    return this.config.sensitiveFields.some(pattern => 
      lowerFieldName.includes(pattern.toLowerCase())
    );
  }

  /**
   * Check if a value looks like sensitive data
   * Enhanced detection for IP addresses, content, and PII
   */
  private isSensitiveValue(value: unknown): boolean {
    if (typeof value !== "string") return false;
    
    const str = value.toLowerCase();
    
    // IP Address patterns (IPv4 and IPv6)
    const ipPatterns = [
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
      /^(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/i,
      /^::ffff:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    ];
    
    // Content patterns that might contain sensitive information
    const contentPatterns = [
      /^[A-F0-9]{32,}$/i,
      /^[GB][A-Z0-9]{55}$/i,
      /^[A-Z0-9]{43}$/i,
      /^[0-9a-f]{64}$/i,
      /^sk_[a-zA-Z0-9]{48,}$/i,
      /^[a-f0-9]{128}$/i,
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      /^\+?[1-9]\d{1,14}$/,
      /^[A-F0-9]{40}$/i,
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
    ];
    
    // Check for message content indicators
    const messageIndicators = [
      "hello", "hi", "hey", "bye", "thank", "please", "sorry", "yes", "no",
      "how are", "what is", "where is", "when is", "why is", "who is"
    ];
    
    // Check IP patterns
    if (ipPatterns.some(pattern => pattern.test(value))) {
      return true;
    }
    
    // Check content patterns
    if (contentPatterns.some(pattern => pattern.test(value))) {
      return true;
    }
    
    // Check for message-like content
    if (str.length > 10 && messageIndicators.some(indicator => str.includes(indicator))) {
      return true;
    }
    
    // Check for potential metadata
    if (str.includes("{") && str.includes("}") && 
        (str.includes("password") || str.includes("token") || str.includes("secret"))) {
      return true;
    }
    
    return false;
  }

  /**
   * Redact sensitive data from an object
   */
  private redactSensitiveData(obj: unknown): unknown {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "string") {
      if (this.isSensitiveValue(obj)) {
        return this.config.redactionChar.repeat(Math.min(obj.length, 8));
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitiveData(item));
    }

    if (typeof obj === "object" && obj !== null) {
      const redacted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.isSensitiveField(key)) {
          redacted[key] = this.config.redactionChar.repeat(8);
        } else {
          redacted[key] = this.redactSensitiveData(value);
        }
      }
      return redacted;
    }

    return obj;
  }

  /**
   * Create a standardized log entry with sensitive data filtering
   */
  private createLogEntry(
    level: LogLevel,
    event: string,
    context: LogContext,
    correlationId?: string
  ): StandardLogFormat {
    const sanitizedContext = this.config.enableSanitization 
      ? this.redactSensitiveData(context) as LogContext
      : context;

    return {
      timestamp: new Date().toISOString(),
      level,
      event,
      correlationId: correlationId ?? this.generateCorrelationId(),
      service: this.config.serviceName,
      version: this.config.serviceVersion,
      context: sanitizedContext,
      sanitized: this.config.enableSanitization
    };
  }

  /**
   * Check if the log level should be processed
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: readonly LogLevel[] = ["debug", "info", "warn", "error"];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const logLevelIndex = levels.indexOf(level);
    return logLevelIndex >= currentLevelIndex;
  }

  /**
   * Output log entry to configured destinations with standardized format
   */
  public output(entry: StandardLogFormat): void {
    // Check log size limits
    const logSize = JSON.stringify(entry).length;
    if (this.config.maxLogSize && logSize > this.config.maxLogSize) {
      // Create a new entry with truncated context
      entry = {
        ...entry,
        context: {
          ...entry.context,
          truncated: true,
          originalSize: logSize
        }
      };
    }

    const logMessage = `[${entry.level.toUpperCase()}] ${entry.service}@${entry.version} - ${entry.event}`;
    const logData = JSON.stringify(entry, null, 2);

    // Console output
    if (this.config.enableConsoleOutput) {
      switch (entry.level) {
        case "debug":
        case "info":
          // eslint-disable-next-line no-console
          console.log(logMessage, logData);
          break;
        case "warn":
          // eslint-disable-next-line no-console
          console.warn(logMessage, logData);
          break;
        case "error":
          // eslint-disable-next-line no-console
          console.error(logMessage, logData);
          break;
      }
    }

    // File output (placeholder for future implementation)
    if (this.config.enableFileOutput) {
      // TODO: Implement file logging with rotation
    }

    // Remote logging with batch processing
    if (this.config.enableRemoteLogging && this.config.remoteConfig) {
      this.logBatch = [...this.logBatch, entry];
      
      // Auto-flush if batch size is reached
      const batchSize = this.config.remoteConfig.batchSize ?? 100;
      if (this.logBatch.length >= batchSize) {
        void this.flushLogBatch();
      }
    }
  }

  /**
   * Log debug information
   */
  debug(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog("debug")) return;
    const entry = this.createLogEntry("debug", event, context, correlationId);
    this.output(entry);
  }

  /**
   * Log informational events
   */
  info(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog("info")) return;
    const entry = this.createLogEntry("info", event, context, correlationId);
    this.output(entry);
  }

  /**
   * Log warning events
   */
  warn(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog("warn")) return;
    const entry = this.createLogEntry("warn", event, context, correlationId);
    this.output(entry);
  }

  /**
   * Log error events
   */
  error(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog("error")) return;
    const entry = this.createLogEntry("error", event, context, correlationId);
    this.output(entry);
  }

  /**
   * Log API request/response events
   */
  logApiRequest(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context: LogContext = {}
  ): void {
    const level = statusCode >= 400 ? "error" : statusCode >= 300 ? "warn" : "info";
    this[level](`API ${method} ${path}`, {
      ...context,
      statusCode,
      duration
    });
  }

  /**
   * Log authentication events
   */
  logAuthEvent(
    action: string,
    success: boolean,
    context: LogContext = {}
  ): void {
    const level = success ? "info" : "warn";
    this[level](`Auth ${action}`, {
      ...context,
      success
    });
  }

  /**
   * Log WebSocket events
   */
  logWebSocketEvent(
    event: string,
    clientId?: string,
    context: LogContext = {}
  ): void {
    this.info(`WebSocket ${event}`, {
      ...context,
      clientId
    });
  }

  /**
   * Log database operations
   */
  logDatabaseOperation(
    operation: string,
    table: string,
    success: boolean,
    context: LogContext = {}
  ): void {
    const level = success ? "info" : "error";
    this[level](`Database ${operation} on ${table}`, {
      ...context,
      table,
      operation,
      success
    });
  }

  /**
   * Flush log batch to remote logging service
   */
  private async flushLogBatch(): Promise<void> {
    if (this.logBatch.length === 0 || !this.config.remoteConfig) return;

    const batchToSend = [...this.logBatch];
    this.logBatch = [];

    try {
      await this.sendToRemoteService(batchToSend);
    } catch (error) {
      // Retry logic
      const retries = this.config.remoteConfig.retryAttempts ?? 3;
      for (let i = 0; i < retries; i++) {
        try {
          await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
          await this.sendToRemoteService(batchToSend);
          break;
        } catch {
          if (i === retries - 1) {
            // Final retry failed, add back to batch
            this.logBatch = [...batchToSend, ...this.logBatch];
          }
        }
      }
    }
  }

  /**
   * Send logs to remote logging service
   */
  private async sendToRemoteService(logs: readonly StandardLogFormat[]): Promise<void> {
    if (!this.config.remoteConfig) return;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.remoteConfig.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.remoteConfig.apiKey}`;
    }

    const response = await fetch(this.config.remoteConfig.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        logs,
        service: this.config.serviceName,
        version: this.config.serviceVersion,
        timestamp: new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error(`Remote logging failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Clean up resources and flush remaining logs
   */
  async cleanup(): Promise<void> {
    if (this.batchTimer !== undefined) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    // Flush any remaining logs
    await this.flushLogBatch();
  }

  /**
   * Validate logging configuration for compliance
   */
  validateConfig(): { readonly valid: boolean; readonly issues: readonly string[] } {
    const issues: string[] = [];
    
    if (!this.config.enableSanitization) {
      issues.push("Sanitization is disabled - sensitive data may be logged");
    }
    
    if (this.config.level === "debug" && this.config.enableRemoteLogging) {
      issues.push("Debug logging with remote logging may expose sensitive information");
    }
    
    if (!this.config.sensitiveFields.includes("ip") || !this.config.sensitiveFields.includes("message")) {
      issues.push("Critical sensitive fields (IP, message) not in filter list");
    }
    
    if (this.config.remoteConfig && !this.config.remoteConfig.endpoint) {
      issues.push("Remote logging enabled but no endpoint configured");
    }
    
    return {
      valid: issues.length === 0,
      issues
    };
  }
}

/**
 * Default logger instance
 */
export const logger = SecureLogger.getInstance();

/**
 * Utility functions for common logging patterns
 */
export const logUtils = {
  /**
   * Create a correlation ID for request tracing
   */
  createCorrelationId: (): string => logger.generateCorrelationId(),

  /**
   * Measure execution time of a function
   */
  async measureTime<T>(
    operation: string,
    fn: () => Promise<T>,
    context: LogContext = {}
  ): Promise<T> {
    const correlationId = logger.generateCorrelationId();
    const startTime = Date.now();
    
    logger.info(`${operation} started`, context, correlationId);
    
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      logger.info(`${operation} completed`, {
        ...context,
        duration
      }, correlationId);
      return result;
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const errorInfo: LogError = {
        type: error instanceof Error ? error.constructor.name : "Unknown",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      };
      logger.error(`${operation} failed`, {
        ...context,
        duration,
        error: errorInfo
      }, correlationId);
      throw error;
    }
  }
};
