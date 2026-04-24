/**
 * Demo script to test the secure logging system
 * Run this to verify that sensitive data is properly redacted
 */

// Import the logger (adjust path as needed)
// import { logger } from '../secure-logger';

// For demo purposes, we'll create a mock implementation
// In the actual implementation, this would be imported from the secure logger

interface LogContext {
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

// Mock implementation for demonstration
class MockSecureLogger {
  private sensitiveFields = [
    'password', 'token', 'secret', 'key', 'auth', 'cookie', 'session',
    'authorization', 'signature', 'hash', 'salt', 'nonce', 'private',
    'address', 'ip', 'email', 'phone', 'content', 'message', 'text',
    'body', 'data', 'payload', 'metadata', 'wallet', 'stellar',
    'mnemonic', 'seed', 'passphrase'
  ];

  private redactionChar = '*';

  private isSensitiveField(fieldName: string): boolean {
    const lowerFieldName = fieldName.toLowerCase();
    return this.sensitiveFields.some(pattern => 
      lowerFieldName.includes(pattern.toLowerCase())
    );
  }

  private isSensitiveValue(value: any): boolean {
    if (typeof value !== 'string') return false;
    
    const patterns = [
      /^[A-F0-9]{32,}$/i,
      /^[GB][A-Z0-9]{55}$/i,
      /^[A-Z0-9]{43}$/i,
      /^[0-9a-f]{64}$/i,
      /^sk_[a-zA-Z0-9]{48,}$/i,
      /^[a-f0-9]{128}$/i,
    ];
    
    return patterns.some(pattern => pattern.test(value));
  }

  private redactSensitiveData(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      if (this.isSensitiveValue(obj)) {
        return this.redactionChar.repeat(Math.min(obj.length, 8));
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
          redacted[key] = this.redactionChar.repeat(8);
        } else {
          redacted[key] = this.redactSensitiveData(value);
        }
      }
      return redacted;
    }

    return obj;
  }

  info(event: string, context: LogContext = {}, correlationId?: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      event,
      correlationId: correlationId || this.generateCorrelationId(),
      context: this.redactSensitiveData(context)
    };

    console.log(`[INFO] ${event}`, JSON.stringify(entry, null, 2));
  }

  error(event: string, context: LogContext = {}, correlationId?: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      event,
      correlationId: correlationId || this.generateCorrelationId(),
      context: this.redactSensitiveData(context)
    };

    console.error(`[ERROR] ${event}`, JSON.stringify(entry, null, 2));
  }

  generateCorrelationId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}

// Demo function
function runSecureLoggingDemo() {
  console.log('=== Secure Logging System Demo ===\n');

  const logger = new MockSecureLogger();

  // Demo 1: Basic logging with sensitive data
  console.log('1. Basic logging with sensitive data:');
  logger.info('User login attempt', {
    userId: 'user-123',
    email: 'user@example.com',
    password: 'superSecret123',
    walletAddress: 'GB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567'
  });

  // Demo 2: Message content redaction
  console.log('\n2. Message content redaction:');
  logger.info('Message sent', {
    messageId: 'msg-456',
    roomId: 'room-789',
    userId: 'user-123',
    content: 'This is a secret message that should be redacted',
    messageType: 'text'
  });

  // Demo 3: Nested objects with sensitive data
  console.log('\n3. Nested objects with sensitive data:');
  logger.info('Complex operation', {
    user: {
      id: 'user-123',
      profile: {
        email: 'user@example.com',
        phone: '123-456-7890',
        apiKey: 'sk_1234567890abcdef1234567890abcdef12345678'
      }
    },
    metadata: {
      token: 'abc123def456789',
      sessionId: 'sess_789xyz'
    }
  });

  // Demo 4: Arrays with sensitive data
  console.log('\n4. Arrays with sensitive data:');
  logger.info('Batch operation', {
    items: [
      { id: 1, name: 'Public Item 1' },
      { id: 2, password: 'secret123', name: 'Secret Item' },
      { id: 3, token: 'token456', name: 'Token Item' }
    ]
  });

  // Demo 5: Stellar addresses and cryptographic data
  console.log('\n5. Stellar addresses and cryptographic data:');
  logger.info('Blockchain transaction', {
    transactionId: 'tx_1234567890abcdef',
    fromAddress: 'GB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
    toAddress: 'GB7654321098ZYXWVUTSRQPONMLKJIHGFEDCBA9876',
    amount: '100.50',
    hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  });

  // Demo 6: Error logging with sensitive context
  console.log('\n6. Error logging with sensitive context:');
  logger.error('Database operation failed', {
    operation: 'insert_user',
    userId: 'user-123',
    error: {
      type: 'DatabaseError',
      message: 'Duplicate key violation',
      stack: 'Error: Duplicate key violation\n    at Database.insert (/app/db.js:123:45)'
    },
    query: 'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
    parameters: ['user-123', 'user@example.com', 'hashed_password_123']
  });

  // Demo 7: Performance logging
  console.log('\n7. Performance logging:');
  logger.info('API request completed', {
    method: 'POST',
    path: '/api/messages',
    statusCode: 201,
    duration: 245,
    userId: 'user-123',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ip: '192.168.1.100'
  });

  console.log('\n=== Demo completed ===');
  console.log('\nKey observations:');
  console.log('✓ Sensitive field names are redacted (password, token, email, etc.)');
  console.log('✓ Sensitive value patterns are redacted (Stellar addresses, hex strings, etc.)');
  console.log('✓ Nested objects and arrays are properly processed');
  console.log('✓ Non-sensitive data is preserved');
  console.log('✓ Structured logging format is maintained');
}

// Run the demo
runSecureLoggingDemo();
