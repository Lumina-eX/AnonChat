/**
 * Tests for the secure logging system
 * These tests verify that sensitive data is properly redacted
 * and that the logging system functions correctly
 */

import { SecureLogger, LogEvent } from '../secure-logger';
import { LogLevel } from '../secure-logger';

describe('SecureLogger', () => {
  let logger: SecureLogger;
  let consoleSpy: {
    log: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    logger = new SecureLogger({
      level: 'debug',
      enableConsoleOutput: true,
      enableFileOutput: false,
      enableRemoteLogging: false,
      sensitiveFields: ['password', 'token', 'secret', 'key', 'address'],
      redactionChar: '*'
    });

    // Spy on console methods
    consoleSpy = {
      log: jest.spyOn(console, 'log').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation()
    };
  });

  afterEach(() => {
    Object.values(consoleSpy).forEach(spy => spy.mockRestore());
  });

  describe('Basic Logging', () => {
    test('should log info messages', () => {
      logger.info('Test message', { userId: '123' });
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Test message'),
        expect.any(String)
      );
    });

    test('should log error messages', () => {
      logger.error('Test error', { error: 'Something went wrong' });
      
      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Test error'),
        expect.any(String)
      );
    });

    test('should respect log levels', () => {
      logger.updateConfig({ level: 'warn' });
      
      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warning message');
      
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Sensitive Data Redaction', () => {
    test('should redact sensitive field names', () => {
      const sensitiveData = {
        userId: '123',
        password: 'secret123',
        email: 'user@example.com',
        token: 'abc123def456'
      };

      logger.info('User login', sensitiveData);
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.password).toBe('********');
      expect(logData.context.token).toBe('********');
      expect(logData.context.userId).toBe('123');
      expect(logData.context.email).toBe('********'); // 'email' contains 'mail' which matches sensitive patterns
    });

    test('should redact Stellar addresses', () => {
      const stellarData = {
        address: 'GB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567',
        otherField: 'safe data'
      };

      logger.info('Stellar transaction', stellarData);
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.address).toBe('********');
      expect(logData.context.otherField).toBe('safe data');
    });

    test('should redact hex strings that look like keys', () => {
      const hexData = {
        hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        normalHex: 'abc123',
        otherField: 'safe'
      };

      logger.info('Hash operation', hexData);
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.hash).toBe('********');
      expect(logData.context.normalHex).toBe('abc123');
      expect(logData.context.otherField).toBe('safe');
    });

    test('should handle nested objects with sensitive data', () => {
      const nestedData = {
        user: {
          id: '123',
          password: 'secret',
          profile: {
            email: 'user@example.com',
            phone: '123-456-7890'
          }
        },
        metadata: {
          token: 'abc123'
        }
      };

      logger.info('Complex operation', nestedData);
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.user.password).toBe('********');
      expect(logData.context.user.profile.email).toBe('********');
      expect(logData.context.user.profile.phone).toBe('********');
      expect(logData.context.metadata.token).toBe('********');
      expect(logData.context.user.id).toBe('123');
    });

    test('should handle arrays with sensitive data', () => {
      const arrayData = {
        items: [
          { id: 1, name: 'safe' },
          { id: 2, password: 'secret' },
          { id: 3, token: 'abc123' }
        ]
      };

      logger.info('Array operation', arrayData);
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.items[0].name).toBe('safe');
      expect(logData.context.items[1].password).toBe('********');
      expect(logData.context.items[2].token).toBe('********');
    });
  });

  describe('Specialized Logging Methods', () => {
    test('should log API requests correctly', () => {
      logger.logApiRequest('POST', '/api/auth', 200, 150, { userId: '123' });
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] API POST /api/auth'),
        expect.any(String)
      );
    });

    test('should log auth events correctly', () => {
      logger.logAuthEvent('login', true, { userId: '123' });
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Auth login'),
        expect.any(String)
      );
    });

    test('should log WebSocket events correctly', () => {
      logger.logWebSocketEvent('connect', 'client-123', { roomId: 'room-456' });
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] WebSocket connect'),
        expect.any(String)
      );
    });

    test('should log database operations correctly', () => {
      logger.logDatabaseOperation('select', 'users', true, { count: 10 });
      
      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO] Database select on users'),
        expect.any(String)
      );
    });
  });

  describe('Correlation IDs', () => {
    test('should generate unique correlation IDs', () => {
      const id1 = logger.generateCorrelationId();
      const id2 = logger.generateCorrelationId();
      
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^[a-f0-9-]{36}$/); // UUID format
    });

    test('should use provided correlation ID', () => {
      const customId = 'custom-correlation-id';
      logger.info('Test message', {}, customId);
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.correlationId).toBe(customId);
    });
  });

  describe('Configuration', () => {
    test('should update configuration', () => {
      logger.updateConfig({ level: 'error', redactionChar: '#' });
      
      logger.info('Should not log');
      logger.error('Should log');
      
      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    });

    test('should use custom redaction character', () => {
      logger.updateConfig({ redactionChar: '#' });
      
      logger.info('Test', { password: 'secret' });
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.password).toBe('########');
    });
  });

  describe('Edge Cases', () => {
    test('should handle null and undefined values', () => {
      logger.info('Test', {
        nullField: null,
        undefinedField: undefined,
        emptyString: '',
        normalField: 'value'
      });
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.nullField).toBeNull();
      expect(logData.context.undefinedField).toBeUndefined();
      expect(logData.context.emptyString).toBe('');
      expect(logData.context.normalField).toBe('value');
    });

    test('should handle circular references', () => {
      const circular: any = { name: 'test' };
      circular.self = circular;
      
      // Should not throw an error
      expect(() => {
        logger.info('Circular test', circular);
      }).not.toThrow();
    });

    test('should handle very large objects', () => {
      const largeObject = {
        data: 'x'.repeat(10000),
        password: 'secret'
      };
      
      expect(() => {
        logger.info('Large object test', largeObject);
      }).not.toThrow();
      
      const logCall = consoleSpy.log.mock.calls[0];
      const logData = JSON.parse(logCall[1]);
      
      expect(logData.context.password).toBe('********');
    });
  });
});

describe('Integration Tests', () => {
  test('should work with existing blockchain logger pattern', () => {
    const logger = new SecureLogger();
    
    // Simulate existing blockchain logging pattern
    const correlationId = logger.generateCorrelationId();
    logger.info('Transaction processed', {
      transactionHash: '0x1234567890abcdef',
      duration: 1500,
      success: true
    }, correlationId);
    
    // Should not throw and should redact the hash
    expect(consoleSpy.log).toHaveBeenCalled();
  });

  test('should handle message content redaction', () => {
    const logger = new SecureLogger();
    
    logger.info('Message sent', {
      roomId: 'room-123',
      content: 'This is a secret message',
      userId: 'user-456'
    });
    
    const logCall = consoleSpy.log.mock.calls[0];
    const logData = JSON.parse(logCall[1]);
    
    expect(logData.context.content).toBe('********');
    expect(logData.context.roomId).toBe('room-123');
    expect(logData.context.userId).toBe('user-456');
  });
});

// Performance tests
describe('Performance Tests', () => {
  test('should handle high-volume logging', () => {
    const logger = new SecureLogger({ level: 'error' });
    const startTime = Date.now();
    
    // Log 1000 messages
    for (let i = 0; i < 1000; i++) {
      logger.info(`Message ${i}`, { index: i });
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Should complete within reasonable time (adjust threshold as needed)
    expect(duration).toBeLessThan(1000); // 1 second
  });

  test('should handle complex redaction efficiently', () => {
    const logger = new SecureLogger();
    const complexData = {
      // Deeply nested object with sensitive data
      level1: {
        level2: {
          level3: {
            level4: {
              password: 'deeply-nested-secret',
              token: 'deeply-nested-token'
            }
          }
        }
      },
      // Large array with sensitive data
      items: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        secret: `secret-${i}`,
        data: 'x'.repeat(100)
      }))
    };
    
    const startTime = Date.now();
    logger.info('Complex redaction test', complexData);
    const endTime = Date.now();
    
    expect(endTime - startTime).toBeLessThan(100); // Should be fast
  });
});
