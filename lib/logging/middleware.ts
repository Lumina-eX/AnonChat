import type { NextRequest, NextResponse } from 'next/server';
import { logger, logUtils } from './secure-logger';
import { LogEvent } from './event-types';

/**
 * Middleware for logging API requests and responses
 */
export function withLogging(
  handler: (req: NextRequest) => Promise<NextResponse>,
  options: {
    includeRequestBody?: boolean;
    includeResponseBody?: boolean;
    excludePaths?: string[];
  } = {}
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const {
      includeRequestBody = false,
      includeResponseBody = false,
      excludePaths = []
    } = options;

    // Skip logging for excluded paths
    if (excludePaths.some(path => req.nextUrl.pathname.startsWith(path))) {
      return handler(req);
    }

    const correlationId = logUtils.createCorrelationId();
    const startTime = Date.now();
    const method = req.method;
    const path = req.nextUrl.pathname;
    const userAgent = req.headers.get('user-agent') || '';
    const referer = req.headers.get('referer') || '';

    // Log request start
    logger.info(LogEvent.API_REQUEST, {
      method,
      path,
      userAgent,
      referer,
      query: Object.fromEntries(req.nextUrl.searchParams),
      ...(includeRequestBody && { bodySize: req.headers.get('content-length') })
    }, correlationId);

    try {
      // Execute the handler
      const response = await handler(req);
      const duration = Date.now() - startTime;
      const statusCode = response.status;

      // Log response
      logger.info(LogEvent.API_RESPONSE, {
        method,
        path,
        statusCode,
        duration,
        userAgent,
        referer,
        ...(includeResponseBody && { responseSize: response.headers.get('content-length') })
      });

      // Add correlation ID to response headers for tracing
      response.headers.set('x-correlation-id', correlationId);

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      // Log error
      logger.error(LogEvent.API_ERROR, {
        method,
        path,
        userAgent,
        referer,
        duration,
        error: {
          type: error instanceof Error ? error.constructor.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      }, correlationId);

      throw error;
    }
  };
}

/**
 * Middleware for logging WebSocket events
 */
export function withWebSocketLogging(
  wsHandler: (ws: any, clientId: string, message: any) => Promise<void>
) {
  return async (ws: any, clientId: string, message: any): Promise<void> => {
    const correlationId = logUtils.createCorrelationId();
    const messageType = message.type || 'unknown';

    logger.info(LogEvent.WS_MESSAGE, {
      clientId,
      messageType,
      messageSize: JSON.stringify(message).length,
      direction: 'received'
    }, correlationId);

    try {
      await wsHandler(ws, clientId, message);
      
      logger.info(LogEvent.WS_MESSAGE, {
        clientId,
        messageType,
        direction: 'processed',
        success: true
      }, correlationId);
    } catch (error) {
      logger.error(LogEvent.WS_ERROR, {
        clientId,
        messageType,
        error: {
          type: error instanceof Error ? error.constructor.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      }, correlationId);
      throw error;
    }
  };
}

/**
 * Middleware for logging database operations
 */
export function withDatabaseLogging<T>(
  operation: string,
  table: string,
  dbOperation: () => Promise<T>,
  context: Record<string, any> = {}
): Promise<T> {
  const correlationId = logUtils.createCorrelationId();
  
  logger.info(LogEvent.DB_QUERY, {
    operation,
    table,
    ...context
  }, correlationId);

  return dbOperation()
    .then(result => {
      logger.info(LogEvent.DB_QUERY, {
        operation,
        table,
        success: true,
        ...context,
        resultCount: Array.isArray(result) ? result.length : 1
      });
      return result;
    })
    .catch(error => {
      logger.error(LogEvent.DB_ERROR, {
        operation,
        table,
        success: false,
        ...context,
        error: {
          type: error instanceof Error ? error.constructor.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      }, correlationId);
      throw error;
    });
}

/**
 * Higher-order function for logging function execution
 */
export function withFunctionLogging<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  options: {
    logArgs?: boolean;
    logResult?: boolean;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
  } = {}
): T {
  const {
    logArgs = false,
    logResult = false,
    logLevel = 'info'
  } = options;

  return (async (...args: any[]) => {
    const correlationId = logUtils.createCorrelationId();
    const startTime = Date.now();

    logger[logLevel](`Function ${functionName} started`, {
      functionName,
      ...(logArgs && { args: args.map(arg => JSON.stringify(arg).slice(0, 100)) })
    }, correlationId);

    try {
      const result = await fn(...args);
      const duration = Date.now() - startTime;

      logger[logLevel](`Function ${functionName} completed`, {
        functionName,
        duration,
        ...(logResult && { resultType: typeof result, resultSize: JSON.stringify(result).length })
      }, correlationId);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error(`Function ${functionName} failed`, {
        functionName,
        duration,
        error: {
          type: error instanceof Error ? error.constructor.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      }, correlationId);

      throw error;
    }
  }) as T;
}

/**
 * Error boundary logging for React components
 */
export function logErrorBoundary(error: Error, errorInfo: any, componentStack?: string) {
  logger.error(LogEvent.ERROR_UNHANDLED, {
    error: {
      type: error.constructor.name,
      message: error.message,
      stack: error.stack
    },
    errorInfo,
    componentStack
  });
}

/**
 * Rate limiting event logging
 */
export function logRateLimitEvent(
  identifier: string,
  limit: number,
  windowMs: number,
  context: Record<string, any> = {}
) {
  logger.warn(LogEvent.SECURITY_RATE_LIMIT_EXCEEDED, {
    identifier,
    limit,
    windowMs,
    ...context
  });
}

/**
 * Security event logging
 */
export function logSecurityEvent(
  event: LogEvent,
  severity: 'low' | 'medium' | 'high' | 'critical',
  context: Record<string, any> = {}
) {
  const logLevel = severity === 'critical' || severity === 'high' ? 'error' : 
                  severity === 'medium' ? 'warn' : 'info';

  logger[logLevel](event, {
    severity,
    timestamp: new Date().toISOString(),
    ...context
  });
}

/**
 * Performance monitoring logging
 */
export function logPerformanceMetric(
  metric: string,
  value: number,
  unit: string,
  context: Record<string, any> = {}
) {
  logger.info(LogEvent.SYSTEM_HEALTH_CHECK, {
    metric,
    value,
    unit,
    ...context
  });
}
