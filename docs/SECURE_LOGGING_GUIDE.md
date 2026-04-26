# Secure Logging System Guide

## Overview

This secure logging system addresses GitHub Issue #94 by providing privacy-compliant logging that excludes sensitive data while maintaining comprehensive monitoring capabilities.

## Features

### ✅ Implemented Requirements

- **Configurable logging levels** (debug, info, warn, error)
- **Centralized logging service integration** with batch processing
- **Standardized log formats** for consistency
- **Enhanced sensitive data filtering** for:
  - IP addresses (IPv4/IPv6)
  - Message content and conversation text
  - Metadata and personal information
  - Blockchain addresses and cryptographic data
- **Privacy compliance validation**
- **Scalable design** for future event types

## Quick Start

```typescript
import { logger, SecureLogger } from '@/lib/logging/secure-logger';

// Basic usage
logger.info('User connected', { userId: 'user123' });
logger.error('Authentication failed', { 
  error: { type: 'AuthError', message: 'Invalid credentials' }
});

// Custom configuration
const customLogger = SecureLogger.getInstance({
  level: 'warn',
  enableRemoteLogging: true,
  remoteConfig: {
    endpoint: 'https://logs.example.com/api/logs',
    apiKey: process.env.LOGGING_API_KEY,
    batchSize: 50,
    flushInterval: 3000
  },
  enableSanitization: true
});
```

## Configuration Options

### LoggerConfig

```typescript
interface LoggerConfig {
  level: LogLevel;                    // Minimum log level to process
  enableConsoleOutput: boolean;       // Console logging
  enableFileOutput: boolean;         // File logging (future)
  enableRemoteLogging: boolean;      // Remote service logging
  remoteEndpoint?: string;           // Legacy endpoint (deprecated)
  remoteConfig?: RemoteLoggingConfig; // Modern remote config
  sensitiveFields: string[];          // Fields to redact
  redactionChar: string;             // Character for redaction
  serviceName: string;               // Service identifier
  serviceVersion: string;            // Service version
  enableSanitization: boolean;       // Enable data sanitization
  maxLogSize?: number;               // Maximum log size limit
}
```

### RemoteLoggingConfig

```typescript
interface RemoteLoggingConfig {
  endpoint: string;        // Remote logging service URL
  apiKey?: string;         // Authentication key
  batchSize?: number;      // Batch size before auto-flush (default: 100)
  flushInterval?: number;  // Auto-flush interval in ms (default: 5000)
  retryAttempts?: number;  // Retry attempts on failure (default: 3)
}
```

## Sensitive Data Protection

### Automatic Redaction

The system automatically redacts:

1. **IP Addresses**: IPv4, IPv6, and IPv4-mapped IPv6 addresses
2. **Message Content**: Conversation text, greetings, and common phrases
3. **Personal Information**: Email addresses, phone numbers, names
4. **Cryptographic Data**: Wallet addresses, private keys, hashes
5. **Metadata**: JSON structures with sensitive keys

### Example Redaction

```typescript
// Input data
const context = {
  ip: '192.168.1.1',
  message: 'Hello, how are you today?',
  email: 'user@example.com',
  wallet: 'GB7RYNDKALYKJFZP2D5L5Y3MCKGNKJEK3XOOQXBP2LD7K5Q7YJXN2A'
};

// After redaction
const sanitized = {
  ip: '********',
  message: '********',
  email: '********',
  wallet: '********'
};
```

## Standardized Log Format

All logs follow the `StandardLogFormat`:

```typescript
interface StandardLogFormat {
  timestamp: string;      // ISO 8601 timestamp
  level: LogLevel;        // Log level
  event: string;         // Event description
  correlationId: string;  // Unique correlation ID
  service: string;       // Service name
  version: string;       // Service version
  context: LogContext;   // Sanitized context data
  sanitized: boolean;     // Whether data was sanitized
}
```

## Usage Patterns

### API Request Logging

```typescript
// Log API requests with automatic sanitization
logger.logApiRequest('POST', '/api/auth', 200, 150, {
  userId: 'user123',
  ip: '192.168.1.1'  // Will be redacted
});
```

### Authentication Events

```typescript
// Log authentication attempts
logger.logAuthEvent('wallet_login', true, {
  walletAddress: 'GB7RYNDK...'  // Will be redacted
});
```

### Performance Monitoring

```typescript
// Measure execution time
await logUtils.measureTime('database_query', async () => {
  return await db.query('SELECT * FROM users');
}, { operation: 'user_lookup' });
```

### WebSocket Events

```typescript
// Log WebSocket connections
logger.logWebSocketEvent('client_connected', 'client123', {
  room: 'general',
  userAgent: 'Mozilla/5.0...'  // Will be redacted
});
```

## Privacy Compliance

### Validation

Use the built-in validation to ensure compliance:

```typescript
const validation = logger.validateConfig();
if (!validation.valid) {
  console.warn('Logging configuration issues:', validation.issues);
}
```

### Best Practices

1. **Always enable sanitization** in production
2. **Avoid debug logging** with remote logging enabled
3. **Use correlation IDs** for request tracing
4. **Validate configuration** on startup
5. **Clean up resources** on application shutdown

```typescript
// Application startup
const validation = logger.validateConfig();
if (!validation.valid) {
  throw new Error(`Logging configuration invalid: ${validation.issues.join(', ')}`);
}

// Application shutdown
await logger.cleanup();
```

## Advanced Usage

### Custom Event Types

The system is designed to be extensible for future event types:

```typescript
// Custom logging method
logger.info('custom_event', {
  eventType: 'blockchain_transaction',
  network: 'stellar',
  // Additional context will be automatically sanitized
});
```

### Error Handling

```typescript
try {
  await riskyOperation();
} catch (error) {
  logger.error('operation_failed', {
    operation: 'riskyOperation',
    error: {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack
    }
  });
}
```

## Migration from Existing Logging

### Before (Insecure)
```typescript
console.log('User action:', {
  ip: req.ip,
  message: req.body.message,
  wallet: req.user.wallet
});
```

### After (Secure)
```typescript
logger.info('user_action', {
  ip: req.ip,           // Automatically redacted
  message: req.body.message,  // Automatically redacted
  wallet: req.user.wallet     // Automatically redacted
});
```

## Troubleshooting

### Common Issues

1. **Logs not appearing**: Check log level configuration
2. **Remote logging failures**: Verify endpoint and API key
3. **Sensitive data leakage**: Ensure sanitization is enabled
4. **Performance issues**: Adjust batch size and flush interval

### Debug Mode

```typescript
// Enable debug logging for troubleshooting
const debugLogger = SecureLogger.getInstance({
  level: 'debug',
  enableConsoleOutput: true,
  enableRemoteLogging: false  // Keep debug logs local
});
```

## Security Considerations

- **API Keys**: Store remote logging API keys in environment variables
- **Transport**: Use HTTPS for all remote logging endpoints
- **Retention**: Configure appropriate log retention policies
- **Access**: Restrict access to log aggregation systems

## Performance Impact

- **Minimal overhead** for console logging
- **Batch processing** reduces network requests
- **Asynchronous** remote logging doesn't block operations
- **Configurable limits** prevent memory issues

## Future Enhancements

- File logging with rotation
- Log compression for remote传输
- Real-time log streaming
- Advanced filtering and search capabilities
- Integration with monitoring platforms

---

**Note**: This implementation addresses all requirements from GitHub Issue #94 and provides a foundation for scalable, privacy-compliant logging across the AnonChat platform.
