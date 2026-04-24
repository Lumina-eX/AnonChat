# Secure Logging System

This document describes the secure logging system implemented for AnonChat, which provides comprehensive logging capabilities while ensuring sensitive data is never stored in logs.

## Overview

The secure logging system is designed to:
- Log essential system events for monitoring and debugging
- Automatically filter and redact sensitive information
- Provide standardized log formats for consistency
- Support centralized logging integration
- Ensure compliance with privacy and security guidelines

## Architecture

### Core Components

1. **SecureLogger** (`lib/logging/secure-logger.ts`)
   - Main logging class with sensitive data filtering
   - Configurable log levels (debug, info, warn, error)
   - Automatic correlation ID generation for request tracing
   - Built-in redaction of sensitive fields and values

2. **Event Types** (`lib/logging/event-types.ts`)
   - Standardized event definitions
   - Event categorization for filtering and analysis
   - Comprehensive coverage of all system operations

3. **Middleware** (`lib/logging/middleware.ts`)
   - API request/response logging
   - WebSocket event logging
   - Database operation logging
   - Function execution tracing

4. **Integrations** (`lib/logging/integrations.ts`)
   - Remote logging providers (Elasticsearch, Logstash, Datadog)
   - Centralized logging management
   - Environment-based configuration

## Quick Start

### Basic Usage

```typescript
import { logger } from '@/lib/logging/secure-logger';
import { LogEvent } from '@/lib/logging/event-types';

// Simple logging
logger.info('User action completed', { userId: '123', action: 'login' });

// With correlation ID for request tracing
const correlationId = logger.generateCorrelationId();
logger.error(LogEvent.AUTH_LOGIN_FAILED, { 
  reason: 'invalid_credentials' 
}, correlationId);

// Using specialized methods
logger.logAuthEvent('login', false, { userId: '123' });
logger.logApiRequest('POST', '/api/auth', 401, 150, { userId: '123' });
```

### Environment Configuration

```bash
# Log level (debug, info, warn, error)
LOG_LEVEL=info

# Enable/disable console output
LOG_CONSOLE=true

# Enable remote logging
LOG_REMOTE=true

# Elasticsearch configuration
ELASTICSEARCH_ENDPOINT=https://your-elasticsearch.com
ELASTICSEARCH_API_KEY=your-api-key
ELASTICSEARCH_INDEX=anonchat-logs

# Datadog configuration
DATADOG_API_KEY=your-datadog-api-key
DATADOG_SERVICE=anonchat
```

### Advanced Configuration

```typescript
import { createIntegratedLogger } from '@/lib/logging/integrations';

const customLogger = createIntegratedLogger({
  level: 'debug',
  enableConsoleOutput: true,
  enableRemoteLogging: true,
  sensitiveFields: ['password', 'token', 'secret'],
  redactionChar: '*',
  remoteProviders: {
    elasticsearch: {
      endpoint: 'https://your-elasticsearch.com',
      apiKey: 'your-api-key',
      index: 'anonchat-logs',
      enabled: true
    },
    datadog: {
      apiKey: 'your-datadog-key',
      service: 'anonchat',
      enabled: true
    }
  }
});
```

## Sensitive Data Protection

### Automatic Redaction

The system automatically redacts:

1. **Field Names**: Any field containing sensitive keywords
   - `password`, `token`, `secret`, `key`, `auth`, `cookie`, `session`
   - `authorization`, `signature`, `hash`, `salt`, `nonce`, `private`
   - `address`, `ip`, `email`, `phone`, `content`, `message`, `text`
   - `body`, `data`, `payload`, `metadata`, `wallet`, `stellar`

2. **Value Patterns**: Strings matching sensitive patterns
   - Hex strings (32+ characters)
   - Stellar addresses (`GB[A-Z0-9]{55}`)
   - Base64 encoded data
   - Hash strings
   - Secret keys (`sk_[a-zA-Z0-9]{48,}`)

### Example Redaction

```typescript
// Input data
const userData = {
  userId: '123',
  email: 'user@example.com',
  password: 'superSecret123',
  walletAddress: 'GB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
  metadata: { token: 'abc123def456' }
};

// Logged output
{
  "userId": "123",
  "email": "********",
  "password": "********",
  "walletAddress": "********",
  "metadata": { "token": "********" }
}
```

## Event Types

### Authentication Events
- `auth.login` - User login attempts
- `auth.logout` - User logout actions
- `auth.wallet_connect` - Wallet connection attempts
- `auth.unauthorized` - Unauthorized access attempts

### API Events
- `api.request` - API request received
- `api.response` - API response sent
- `api.error` - API errors
- `api.rate_limit` - Rate limiting events

### WebSocket Events
- `ws.connect` - Client connections
- `ws.disconnect` - Client disconnections
- `ws.message` - Message handling
- `ws.room_join` - Room participation

### Security Events
- `security.breach` - Security breaches
- `security.suspicious_activity` - Suspicious activities
- `security.rate_limit_exceeded` - Rate limit violations

### Performance Events
- `performance.slow_query` - Slow database queries
- `performance.high_latency` - High latency operations
- `performance.timeout` - Operation timeouts

## Middleware Usage

### API Logging

```typescript
import { withLogging } from '@/lib/logging/middleware';

export const GET = withLogging(async (request: NextRequest) => {
  // Your API logic here
  return NextResponse.json({ data: 'success' });
}, {
  includeRequestBody: false,  // Don't log request bodies (security)
  includeResponseBody: false,  // Don't log response bodies (security)
  excludePaths: ['/health', '/metrics']  // Skip logging for health checks
});
```

### Database Logging

```typescript
import { withDatabaseLogging } from '@/lib/logging/middleware';

const result = await withDatabaseLogging(
  'select',
  'users',
  () => supabase.from('users').select('*'),
  { filter: 'active=true' }
);
```

### Function Logging

```typescript
import { withFunctionLogging } from '@/lib/logging/middleware';

const processMessage = withFunctionLogging(
  async (message: string) => {
    // Your function logic
    return processedMessage;
  },
  'processMessage',
  {
    logArgs: false,  // Don't log arguments (security)
    logResult: false,  // Don't log results (security)
    logLevel: 'info'
  }
);
```

## Centralized Logging

### Supported Providers

1. **Elasticsearch**
   - Full-text search capabilities
   - Real-time log analysis
   - Kibana dashboard integration

2. **Logstash**
   - Log processing and transformation
   - Multiple output destinations
   - Grok pattern matching

3. **Datadog**
   - APM integration
   - Real-time monitoring
   - Alerting and dashboards

4. **HTTP Webhooks**
   - Custom endpoints
   - Slack notifications
   - Custom integrations

### Configuration Examples

```typescript
// Elasticsearch
const elasticsearchProvider = new ElasticsearchProvider({
  endpoint: 'https://your-elasticsearch.com:9200',
  apiKey: 'your-api-key',
  index: 'anonchat-logs',
  enabled: true
});

// Datadog
const datadogProvider = new DatadogProvider({
  apiKey: 'your-datadog-api-key',
  site: 'datadoghq.com',
  service: 'anonchat',
  enabled: true
});

// HTTP Webhook
const httpProvider = new HttpProvider({
  endpoint: 'https://your-webhook.com/logs',
  headers: { 'Authorization': 'Bearer token' },
  batchSize: 100,
  enabled: true
});
```

## Best Practices

### Security
1. **Never log sensitive data**: The system automatically redacts sensitive fields
2. **Use correlation IDs**: Always include correlation IDs for request tracing
3. **Sanitize inputs**: Ensure user inputs are sanitized before logging
4. **Review logs regularly**: Monitor for security events and anomalies

### Performance
1. **Appropriate log levels**: Use debug for development, info for production
2. **Batch remote logging**: Configure appropriate batch sizes for remote providers
3. **Asynchronous logging**: Remote logging is non-blocking by default
4. **Monitor log volume**: Set up alerts for excessive logging

### Development
1. **Consistent event types**: Use predefined event types for consistency
2. **Structured data**: Always log structured data, not strings
3. **Context information**: Include relevant context (userId, roomId, etc.)
4. **Error handling**: Always include error details in error logs

## Migration Guide

### From Console Logging

```typescript
// Before
console.log('User logged in:', userId);
console.error('Database error:', error);

// After
logger.info(LogEvent.AUTH_LOGIN, { userId });
logger.error(LogEvent.DB_ERROR, { 
  error: {
    type: error.constructor.name,
    message: error.message,
    stack: error.stack
  }
});
```

### From Existing Logger

```typescript
// Before
logBlockchainOperation('info', 'Transaction processed', {
  transactionHash: '0x123...',
  duration: 1500
});

// After
logger.info(LogEvent.BLOCKCHAIN_TRANSACTION, {
  duration: 1500,
  transactionHash: '********'  // Automatically redacted
});
```

## Troubleshooting

### Common Issues

1. **Logs not appearing in remote systems**
   - Check provider configuration
   - Verify network connectivity
   - Check authentication credentials

2. **Sensitive data in logs**
   - Review sensitive field configuration
   - Check custom field patterns
   - Verify redaction character settings

3. **Performance issues**
   - Reduce log level in production
   - Increase batch sizes for remote logging
   - Disable verbose logging

### Debug Mode

```typescript
// Enable debug logging
logger.updateConfig({ level: 'debug' });

// Check provider status
import { centralizedLogger } from '@/lib/logging/integrations';
console.log(centralizedLogger.getProviderStatus());
```

## API Reference

### SecureLogger

#### Methods
- `debug(event, context, correlationId?)`
- `info(event, context, correlationId?)`
- `warn(event, context, correlationId?)`
- `error(event, context, correlationId?)`
- `logApiRequest(method, path, statusCode, duration, context)`
- `logAuthEvent(action, success, context)`
- `logWebSocketEvent(event, clientId, context)`
- `logDatabaseOperation(operation, table, success, context)`
- `generateCorrelationId()`
- `updateConfig(config)`

### Configuration Options

```typescript
interface LoggerConfig {
  level: LogLevel;           // debug | info | warn | error
  enableConsoleOutput: boolean;
  enableFileOutput: boolean;
  enableRemoteLogging: boolean;
  remoteEndpoint?: string;
  sensitiveFields: string[];
  redactionChar: string;
}
```

## Support

For questions or issues with the secure logging system:

1. Check this documentation
2. Review the implementation in `lib/logging/`
3. Test with debug logging enabled
4. Check environment configuration
5. Verify remote provider settings

## Version History

- **v1.0.0**: Initial secure logging implementation
  - Core SecureLogger class
  - Sensitive data filtering
  - Standardized event types
  - Middleware support
  - Remote integrations
