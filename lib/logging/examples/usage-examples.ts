/**
 * Usage examples for the secure logging system
 * These examples demonstrate how to use the logging system in various scenarios
 */

import { logger } from '../secure-logger';
import { LogEvent } from '../event-types';
import { withLogging, withDatabaseLogging } from '../middleware';
import { createIntegratedLogger } from '../integrations';
// import { NextRequest, NextResponse } from 'next/server';

// =============================================================================
// BASIC USAGE EXAMPLES
// =============================================================================

// Example 1: Simple logging
export function basicLoggingExample() {
  // Basic info logging
  logger.info('User action completed', { 
    userId: 'user-123',
    action: 'profile_updated'
  });

  // Error logging with context
  logger.error('Database connection failed', {
    error: {
      type: 'DatabaseError',
      message: 'Duplicate key violation'
    },
    retryCount: 3
  });

  // Warning logging
  logger.warn('Rate limit approaching', {
    userId: 'user-123',
    currentRequests: 95,
    limit: 100,
    windowMinutes: 15
  });
}

// Example 2: Using correlation IDs for request tracing
export function requestTracingExample() {
  const correlationId = logger.generateCorrelationId();
  
  logger.info('Request started', {
    method: 'POST',
    path: '/api/messages',
    userId: 'user-123'
  }, correlationId);

  // ... processing logic ...

  logger.info('Request completed', {
    method: 'POST',
    path: '/api/messages',
    userId: 'user-123',
    duration: 250,
    statusCode: 201
  }, correlationId);
}

// =============================================================================
// SPECIALIZED LOGGING METHODS
// =============================================================================

// Example 3: API request logging
export function apiLoggingExample() {
  // Log successful API request
  logger.logApiRequest('GET', '/api/rooms', 200, 45, {
    userId: 'user-123',
    roomCount: 5
  });

  // Log failed API request
  logger.logApiRequest('POST', '/api/auth/login', 401, 120, {
    userId: 'user-123',
    reason: 'invalid_credentials'
  });
}

// Example 4: Authentication event logging
export function authLoggingExample() {
  // Successful login
  logger.logAuthEvent('login', true, {
    userId: 'user-123',
    method: 'wallet',
    walletType: 'stellar'
  });

  // Failed login attempt
  logger.logAuthEvent('login', false, {
    userId: 'user-123',
    method: 'wallet',
    reason: 'signature_invalid'
  });
}

// Example 5: WebSocket event logging
export function websocketLoggingExample() {
  // Client connection
  logger.logWebSocketEvent('connect', 'client-456', {
    userAgent: 'Mozilla/5.0...',
    ip: '********' // Automatically redacted
  });

  // Message handling
  logger.logWebSocketEvent('message', 'client-456', {
    messageType: 'join_room',
    roomId: 'room-789'
  });

  // Client disconnection
  logger.logWebSocketEvent('disconnect', 'client-456', {
    reason: 'client_disconnect',
    duration: 1800
  });
}

// Example 6: Database operation logging
export function databaseLoggingExample() {
  // Successful query
  logger.logDatabaseOperation('select', 'messages', true, {
    roomId: 'room-789',
    limit: 50,
    resultCount: 25
  });

  // Failed operation
  logger.logDatabaseOperation('insert', 'messages', false, {
    roomId: 'room-789',
    error: {
      type: 'ValidationError',
      message: 'Content cannot be empty'
    }
  });
}

// =============================================================================
// MIDDLEWARE EXAMPLES
// =============================================================================

// Example 8: Database operation with logging
const fetchUsersFromDatabase = async (roomId: string) => {
  // Mock database logic
  return [{ id: 'user-1', name: 'User 1' }];
};
export async function getUsersWithLogging(roomId: string) {
  return withDatabaseLogging(
    'select',
    'users',
    () => fetchUsersFromDatabase(roomId),
    { roomId, filter: 'active_only' }
  );
}

// =============================================================================
// SENSITIVE DATA HANDLING EXAMPLES
// =============================================================================

// Example 9: Automatic sensitive data redaction
export function sensitiveDataExample() {
  // This data contains sensitive information that will be automatically redacted
  const userData = {
    userId: 'user-123',
    email: 'user@example.com',        // Will be redacted (contains 'email')
    password: 'superSecret123',        // Will be redacted (contains 'password')
    walletAddress: 'GB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567', // Will be redacted (Stellar address)
    metadata: {
      token: 'abc123def456',           // Will be redacted (contains 'token')
      apiKey: 'sk_1234567890abcdef'   // Will be redacted (contains 'key' and matches secret key pattern)
    }
  };

  // Log the data - sensitive fields will be automatically redacted
  logger.info('User registration completed', userData);
  
  // Output will show:
  // {
  //   "userId": "user-123",
  //   "email": "********",
  //   "password": "********",
  //   "walletAddress": "********",
  //   "metadata": {
  //     "token": "********",
  //     "apiKey": "********"
  //   }
  // }
}

// Example 10: Message content redaction
export function messageLoggingExample() {
  const messageData = {
    messageId: 'msg-456',
    roomId: 'room-789',
    userId: 'user-123',
    content: 'This is a secret message that should not be logged', // Will be redacted
    messageType: 'text',
    encrypted: false
  };

  logger.info('Message sent', messageData);
  
  // The content field will be redacted to "********"
}

// =============================================================================
// ADVANCED CONFIGURATION EXAMPLES
// =============================================================================

// Example 11: Custom logger configuration
export function customLoggerExample() {
  const customLogger = createIntegratedLogger({
    level: 'debug',
    enableConsoleOutput: true,
    enableFileOutput: false,
    enableRemoteLogging: true,
    sensitiveFields: ['password', 'token', 'secret', 'custom_field'],
    redactionChar: '#',
    remoteProviders: {
      elasticsearch: {
        endpoint: 'https://your-elasticsearch.com:9200',
        apiKey: 'your-api-key',
        index: 'anonchat-logs',
        enabled: true
      }
    }
  });

  // Use the custom logger
  customLogger.info('Custom logging example', {
    userId: 'user-123',
    custom_field: 'sensitive_data', // Will be redacted with '#'
    normalField: 'safe_data'
  });
}

// Example 12: Environment-based configuration
export function environmentLoggerExample() {
  // This will automatically load configuration from environment variables
  // import { envLogger } from '../integrations';
  
  // envLogger.info('Environment-based logging', {
  //   userId: 'user-123',
  //   action: 'environment_test'
  // });
}

// =============================================================================
// ERROR HANDLING EXAMPLES
// =============================================================================

// Example 13: Comprehensive error logging
export function errorLoggingExample() {
  try {
    // Some operation that might fail
    throw new Error('Database connection timeout');
  } catch (error) {
    logger.error('Operation failed', {
      operation: 'database_query',
      userId: 'user-123',
      error: {
        type: error instanceof Error ? error.constructor.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      },
      retryCount: 2,
      timeout: 5000
    });
  }
}

// Example 14: Performance monitoring
export function performanceLoggingExample() {
  const startTime = Date.now();
  
  // Simulate some work
  setTimeout(() => {
    const duration = Date.now() - startTime;
    
    if (duration > 1000) {
      logger.warn('Slow operation detected', {
        operation: 'data_processing',
        duration,
        threshold: 1000
      });
    } else {
      logger.info('Operation completed', {
        operation: 'data_processing',
        duration
      });
    }
  }, 1500);
}

// =============================================================================
// REAL-WORLD SCENARIOS
// =============================================================================

// Example 15: User registration flow
export function userRegistrationFlow() {
  const correlationId = logger.generateCorrelationId();
  
  logger.info(LogEvent.AUTH_REGISTER, {
    step: 'validation_started',
    email: 'user@example.com'
  }, correlationId);

  // Validate user input
  logger.info(LogEvent.AUTH_REGISTER, {
    step: 'validation_completed',
    email: '********',
    valid: true
  }, correlationId);

  // Create user account
  logger.info(LogEvent.AUTH_REGISTER, {
    step: 'account_creation',
    userId: 'user-123'
  }, correlationId);

  // Send welcome email
  logger.info(LogEvent.AUTH_REGISTER, {
    step: 'welcome_email_sent',
    userId: 'user-123'
  }, correlationId);

  logger.info(LogEvent.AUTH_REGISTER, {
    step: 'registration_completed',
    userId: 'user-123',
    totalDuration: 2500
  }, correlationId);
}

// Example 16: Message sending flow
export function messageSendingFlow() {
  const correlationId = logger.generateCorrelationId();
  
  logger.info(LogEvent.MESSAGE_CREATE, {
    step: 'validation',
    roomId: 'room-789',
    userId: 'user-123'
  }, correlationId);

  logger.info(LogEvent.MESSAGE_ENCRYPT, {
    step: 'encryption',
    roomId: 'room-789',
    userId: 'user-123',
    encrypted: true
  }, correlationId);

  logger.info(LogEvent.MESSAGE_SEND, {
    step: 'delivery',
    roomId: 'room-789',
    userId: 'user-123',
    deliveryMethod: 'websocket'
  }, correlationId);

  logger.info(LogEvent.MESSAGE_CREATE, {
    step: 'completed',
    roomId: 'room-789',
    userId: 'user-123',
    messageId: 'msg-456',
    totalDuration: 150
  }, correlationId);
}

// Example 17: Security event monitoring
export function securityEventMonitoring() {
  // Failed login attempt
  logger.logAuthEvent('login', false, {
    userId: 'user-123',
    ip: '********', // Automatically redacted
    userAgent: 'Mozilla/5.0...',
    reason: 'invalid_credentials'
  });

  // Multiple failed attempts - potential security issue
  logger.warn(LogEvent.SECURITY_SUSPICIOUS_ACTIVITY, {
    userId: 'user-123',
    event: 'multiple_failed_logins',
    attemptCount: 5,
    timeWindow: 300, // 5 minutes
    severity: 'medium'
  });

  // Rate limit exceeded
  logger.warn(LogEvent.SECURITY_RATE_LIMIT_EXCEEDED, {
    identifier: 'user-123',
    limit: 100,
    currentCount: 101,
    windowMs: 900000, // 15 minutes
    endpoint: '/api/messages'
  });
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

// Example 18: Utility function for timed operations
export async function timedOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  context: Record<string, any> = {}
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

// Example 19: Usage of the timed utility
export async function exampleTimedUsage() {
  return timedOperation('user_profile_update', async () => {
    // Simulate updating user profile
    await new Promise(resolve => setTimeout(resolve, 200));
    
    return { success: true, profileId: 'profile-123' };
  }, {
    userId: 'user-123',
    fields: ['name', 'email', 'avatar']
  });
}

// =============================================================================
// TESTING EXAMPLES
// =============================================================================

// Example 20: Testing with mock logger
export function testingExample() {
  // In tests, you might want to use a mock logger
  // const mockLogger = new SecureLogger({
  //   level: 'debug',
  //   enableConsoleOutput: false, // Disable console output in tests
  //   enableRemoteLogging: false,
  //   sensitiveFields: ['password', 'token']
  // });

  // Test that sensitive data is properly redacted
  // mockLogger.info('Test logging', {
  //   userId: 'test-user',
  //   password: 'test-password',
  //   safeField: 'test-data'
  // });

  // Assert that log contains redacted data
  // (This would be done in your actual test framework)
}
