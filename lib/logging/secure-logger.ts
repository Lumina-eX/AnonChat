import { randomUUID } from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  userId?: string;
  roomId?: string;
  sessionId?: string;
  requestId?: string;
  duration?: number;
  error?: {
    type: string;
    message: string;
    stack?: string;
  };
  [key: string]: any;
}

export interface SecureLogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  correlationId: string;
  context: LogContext;
  metadata?: Record<string, any>;
}

export interface LoggerConfig {
  level: LogLevel;
  enableConsoleOutput: boolean;
  enableFileOutput: boolean;
  enableRemoteLogging: boolean;
  remoteEndpoint?: string;
  sensitiveFields: string[];
  redactionChar: string;
}

/**
 * Default sensitive fields that should be redacted from logs
 */
const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'token',
  'secret',
  'key',
  'auth',
  'cookie',
  'session',
  'authorization',
  'signature',
  'hash',
  'salt',
  'nonce',
  'private',
  'address',
  'ip',
  'email',
  'phone',
  'content',
  'message',
  'text',
  'body',
  'data',
  'payload',
  'metadata',
  'wallet',
  'stellar',
  'mnemonic',
  'seed',
  'passphrase'
];

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  enableConsoleOutput: true,
  enableFileOutput: false,
  enableRemoteLogging: false,
  sensitiveFields: DEFAULT_SENSITIVE_FIELDS,
  redactionChar: '*'
};

/**
 * Secure Logger class that provides centralized logging with sensitive data filtering
 */
export class SecureLogger {
  private config: LoggerConfig;
  private static instance: SecureLogger;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
    this.config = { ...this.config, ...config };
  }

  /**
   * Generate correlation ID for tracing
   */
  generateCorrelationId(): string {
    return randomUUID();
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
   */
  private isSensitiveValue(value: any): boolean {
    if (typeof value !== 'string') return false;
    
    // Check for common sensitive data patterns
    const patterns = [
      /^[A-F0-9]{32,}$/i, // Hex strings (possible keys, hashes)
      /^[GB][A-Z0-9]{55}$/i, // Stellar addresses
      /^[A-Z0-9]{43}$/i, // Possible base64 encoded data
      /^[0-9a-f]{64}$/i, // 256-bit hash
      /^sk_[a-zA-Z0-9]{48,}$/i, // Secret keys
      /^[a-f0-9]{128}$/i, // 512-bit hash
    ];
    
    return patterns.some(pattern => pattern.test(value));
  }

  /**
   * Redact sensitive data from an object
   */
  private redactSensitiveData(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      if (this.isSensitiveValue(obj)) {
        return this.config.redactionChar.repeat(Math.min(obj.length, 8));
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitiveData(item));
    }

    if (typeof obj === 'object') {
      const redacted: any = {};
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
   * Create a log entry with sensitive data filtering
   */
  private createLogEntry(
    level: LogLevel,
    event: string,
    context: LogContext,
    correlationId?: string
  ): SecureLogEntry {
    const entry: SecureLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      correlationId: correlationId || this.generateCorrelationId(),
      context: this.redactSensitiveData(context)
    };

    return entry;
  }

  /**
   * Check if the log level should be processed
   */
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.config.level);
    const logLevelIndex = levels.indexOf(level);
    return logLevelIndex >= currentLevelIndex;
  }

  /**
   * Output log entry to configured destinations
   */
  public output(entry: SecureLogEntry): void {
    const logMessage = `[${entry.level.toUpperCase()}] ${entry.event}`;
    const logData = JSON.stringify(entry, null, 2);

    if (this.config.enableConsoleOutput) {
      switch (entry.level) {
        case 'debug':
        case 'info':
          console.log(logMessage, logData);
          break;
        case 'warn':
          console.warn(logMessage, logData);
          break;
        case 'error':
          console.error(logMessage, logData);
          break;
      }
    }

    // Future: Add file output and remote logging capabilities
    if (this.config.enableFileOutput) {
      // TODO: Implement file logging
    }

    if (this.config.enableRemoteLogging && this.config.remoteEndpoint) {
      // TODO: Implement remote logging
    }
  }

  /**
   * Log debug information
   */
  debug(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog('debug')) return;
    const entry = this.createLogEntry('debug', event, context, correlationId);
    this.output(entry);
  }

  /**
   * Log informational events
   */
  info(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog('info')) return;
    const entry = this.createLogEntry('info', event, context, correlationId);
    this.output(entry);
  }

  /**
   * Log warning events
   */
  warn(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog('warn')) return;
    const entry = this.createLogEntry('warn', event, context, correlationId);
    this.output(entry);
  }

  /**
   * Log error events
   */
  error(event: string, context: LogContext = {}, correlationId?: string): void {
    if (!this.shouldLog('error')) return;
    const entry = this.createLogEntry('error', event, context, correlationId);
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
    const level = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'info';
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
    const level = success ? 'info' : 'warn';
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
    const level = success ? 'info' : 'error';
    this[level](`Database ${operation} on ${table}`, {
      ...context,
      table,
      operation,
      success
    });
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
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`${operation} failed`, {
        ...context,
        duration,
        error: {
          type: error instanceof Error ? error.constructor.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      }, correlationId);
      throw error;
    }
  }
};
