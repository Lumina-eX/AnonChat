import { logger, LoggerConfig } from './secure-logger';
import { LogEvent } from './event-types';

/**
 * Remote logging integration interface
 */
export interface RemoteLoggingProvider {
  send(logs: any[]): Promise<void>;
  name: string;
  enabled: boolean;
}

/**
 * Elasticsearch integration for centralized logging
 */
export class ElasticsearchProvider implements RemoteLoggingProvider {
  name = 'elasticsearch';
  enabled: boolean;
  private endpoint: string;
  private apiKey?: string;
  private index: string;

  constructor(config: {
    endpoint: string;
    apiKey?: string;
    index: string;
    enabled: boolean;
  }) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.index = config.index;
    this.enabled = config.enabled;
  }

  async send(logs: any[]): Promise<void> {
    if (!this.enabled) return;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `ApiKey ${this.apiKey}`;
      }

      const response = await fetch(`${this.endpoint}/${this.index}/_bulk`, {
        method: 'POST',
        headers,
        body: this.formatBulkRequest(logs)
      });

      if (!response.ok) {
        throw new Error(`Elasticsearch indexing failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[Elasticsearch] Failed to send logs:', error);
    }
  }

  private formatBulkRequest(logs: any[]): string {
    const bulkBody: string[] = [];
    
    logs.forEach(log => {
      bulkBody.push(JSON.stringify({ index: { _index: this.index } }));
      bulkBody.push(JSON.stringify(log));
    });

    return bulkBody.join('\n') + '\n';
  }
}

/**
 * Logstash integration for centralized logging
 */
export class LogstashProvider implements RemoteLoggingProvider {
  name = 'logstash';
  enabled: boolean;
  private endpoint: string;
  private username?: string;
  private password?: string;

  constructor(config: {
    endpoint: string;
    username?: string;
    password?: string;
    enabled: boolean;
  }) {
    this.endpoint = config.endpoint;
    this.username = config.username;
    this.password = config.password;
    this.enabled = config.enabled;
  }

  async send(logs: any[]): Promise<void> {
    if (!this.enabled) return;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.username && this.password) {
        const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
      }

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(logs)
      });

      if (!response.ok) {
        throw new Error(`Logstash delivery failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[Logstash] Failed to send logs:', error);
    }
  }
}

/**
 * Datadog integration for centralized logging
 */
export class DatadogProvider implements RemoteLoggingProvider {
  name = 'datadog';
  enabled: boolean;
  private apiKey: string;
  private site: string;
  private service: string;

  constructor(config: {
    apiKey: string;
    site?: string;
    service?: string;
    enabled: boolean;
  }) {
    this.apiKey = config.apiKey;
    this.site = config.site || 'datadoghq.com';
    this.service = config.service || 'anonchat';
    this.enabled = config.enabled;
  }

  async send(logs: any[]): Promise<void> {
    if (!this.enabled) return;

    try {
      const datadogLogs = logs.map(log => ({
        ...log,
        ddsource: 'nodejs',
        ddservice: this.service,
        hostname: process.env.HOSTNAME || 'unknown',
        timestamp: new Date(log.timestamp).getTime() * 1000000 // Convert to nanoseconds
      }));

      const response = await fetch(
        `https://http-intake.logs.${this.site}/api/v2/logs`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'DD-API-KEY': this.apiKey
          },
          body: JSON.stringify(datadogLogs)
        }
      );

      if (!response.ok) {
        throw new Error(`Datadog logging failed: ${response.statusText}`);
      }
    } catch (error) {
      console.error('[Datadog] Failed to send logs:', error);
    }
  }
}

/**
 * Custom HTTP provider for generic webhooks
 */
export class HttpProvider implements RemoteLoggingProvider {
  name = 'http';
  enabled: boolean;
  private endpoint: string;
  private headers: Record<string, string>;
  private batchSize: number;

  constructor(config: {
    endpoint: string;
    headers?: Record<string, string>;
    batchSize?: number;
    enabled: boolean;
  }) {
    this.endpoint = config.endpoint;
    this.headers = config.headers || {};
    this.batchSize = config.batchSize || 100;
    this.enabled = config.enabled;
  }

  async send(logs: any[]): Promise<void> {
    if (!this.enabled) return;

    try {
      const batches = this.createBatches(logs, this.batchSize);
      
      for (const batch of batches) {
        const response = await fetch(this.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.headers
          },
          body: JSON.stringify({
            logs: batch,
            timestamp: new Date().toISOString(),
            source: 'anonchat'
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP logging failed: ${response.statusText}`);
        }
      }
    } catch (error) {
      console.error('[HTTP] Failed to send logs:', error);
    }
  }

  private createBatches<T>(array: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }
}

/**
 * Centralized logging manager
 */
export class CentralizedLogger {
  private providers: RemoteLoggingProvider[] = [];
  private buffer: any[] = [];
  private bufferSize: number;
  private flushInterval: number;
  private flushTimer?: NodeJS.Timeout;

  constructor(config: {
    bufferSize?: number;
    flushInterval?: number;
  } = {}) {
    this.bufferSize = config.bufferSize || 50;
    this.flushInterval = config.flushInterval || 5000; // 5 seconds
    this.startFlushTimer();
  }

  /**
   * Add a remote logging provider
   */
  addProvider(provider: RemoteLoggingProvider): void {
    this.providers.push(provider);
  }

  /**
   * Remove a remote logging provider
   */
  removeProvider(providerName: string): void {
    this.providers = this.providers.filter(p => p.name !== providerName);
  }

  /**
   * Send logs to all enabled providers
   */
  async sendToProviders(logs: any[]): Promise<void> {
    const enabledProviders = this.providers.filter(p => p.enabled);
    
    if (enabledProviders.length === 0) return;

    const promises = enabledProviders.map(provider => 
      provider.send(logs).catch(error => {
        console.error(`[${provider.name}] Failed to send logs:`, error);
      })
    );

    await Promise.allSettled(promises);
  }

  /**
   * Add log to buffer
   */
  addToBuffer(log: any): void {
    this.buffer.push(log);
    
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  /**
   * Flush buffer to remote providers
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const logs = [...this.buffer];
    this.buffer = [];

    await this.sendToProviders(logs);
  }

  /**
   * Start automatic flush timer
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * Stop automatic flush timer
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flush();
  }

  /**
   * Get provider status
   */
  getProviderStatus(): Array<{ name: string; enabled: boolean }> {
    return this.providers.map(p => ({ name: p.name, enabled: p.enabled }));
  }
}

/**
 * Global centralized logger instance
 */
export const centralizedLogger = new CentralizedLogger();

/**
 * Enhanced secure logger with remote integration
 */
export function createIntegratedLogger(config: LoggerConfig & {
  remoteProviders?: {
    elasticsearch?: any;
    logstash?: any;
    datadog?: any;
    http?: any;
  };
}) {
  const secureLogger = logger;
  
  // Configure remote providers if specified
  if (config.remoteProviders) {
    if (config.remoteProviders.elasticsearch) {
      centralizedLogger.addProvider(
        new ElasticsearchProvider(config.remoteProviders.elasticsearch)
      );
    }
    
    if (config.remoteProviders.logstash) {
      centralizedLogger.addProvider(
        new LogstashProvider(config.remoteProviders.logstash)
      );
    }
    
    if (config.remoteProviders.datadog) {
      centralizedLogger.addProvider(
        new DatadogProvider(config.remoteProviders.datadog)
      );
    }
    
    if (config.remoteProviders.http) {
      centralizedLogger.addProvider(
        new HttpProvider(config.remoteProviders.http)
      );
    }
  }

  // Override output method to include remote logging
  const originalOutput = secureLogger.output.bind(secureLogger);
  secureLogger.output = function(entry: any) {
    // Original console output
    originalOutput(entry);
    
    // Send to remote providers
    centralizedLogger.addToBuffer(entry);
  };

  return secureLogger;
}

/**
 * Environment-based logger configuration
 */
export function createLoggerFromEnvironment() {
  const config: LoggerConfig = {
    level: (process.env.LOG_LEVEL as any) || 'info',
    enableConsoleOutput: process.env.LOG_CONSOLE !== 'false',
    enableFileOutput: process.env.LOG_FILE === 'true',
    enableRemoteLogging: process.env.LOG_REMOTE === 'true',
    remoteEndpoint: process.env.LOG_REMOTE_ENDPOINT,
    sensitiveFields: process.env.LOG_SENSITIVE_FIELDS?.split(',') || [
      'password', 'token', 'secret', 'key', 'auth', 'cookie', 'session',
      'authorization', 'signature', 'hash', 'salt', 'nonce', 'private',
      'address', 'ip', 'email', 'phone', 'content', 'message', 'text',
      'body', 'data', 'payload', 'metadata', 'wallet', 'stellar',
      'mnemonic', 'seed', 'passphrase'
    ],
    redactionChar: process.env.LOG_REDACTION_CHAR || '*'
  };

  const remoteProviders: any = {};
  
  // Elasticsearch configuration
  if (process.env.ELASTICSEARCH_ENDPOINT) {
    remoteProviders.elasticsearch = {
      endpoint: process.env.ELASTICSEARCH_ENDPOINT,
      apiKey: process.env.ELASTICSEARCH_API_KEY,
      index: process.env.ELASTICSEARCH_INDEX || 'anonchat-logs',
      enabled: process.env.ELASTICSEARCH_ENABLED !== 'false'
    };
  }

  // Logstash configuration
  if (process.env.LOGSTASH_ENDPOINT) {
    remoteProviders.logstash = {
      endpoint: process.env.LOGSTASH_ENDPOINT,
      username: process.env.LOGSTASH_USERNAME,
      password: process.env.LOGSTASH_PASSWORD,
      enabled: process.env.LOGSTASH_ENABLED !== 'false'
    };
  }

  // Datadog configuration
  if (process.env.DATADOG_API_KEY) {
    remoteProviders.datadog = {
      apiKey: process.env.DATADOG_API_KEY,
      site: process.env.DATADOG_SITE || 'datadoghq.com',
      service: process.env.DATADOG_SERVICE || 'anonchat',
      enabled: process.env.DATADOG_ENABLED !== 'false'
    };
  }

  // HTTP webhook configuration
  if (process.env.HTTP_LOG_ENDPOINT) {
    remoteProviders.http = {
      endpoint: process.env.HTTP_LOG_ENDPOINT,
      headers: process.env.HTTP_LOG_HEADERS ? 
        JSON.parse(process.env.HTTP_LOG_HEADERS) : undefined,
      batchSize: parseInt(process.env.HTTP_LOG_BATCH_SIZE || '100'),
      enabled: process.env.HTTP_LOG_ENABLED !== 'false'
    };
  }

  return createIntegratedLogger({
    ...config,
    remoteProviders: Object.keys(remoteProviders).length > 0 ? remoteProviders : undefined
  });
}

/**
 * Initialize logger with environment configuration
 */
export const envLogger = createLoggerFromEnvironment();
