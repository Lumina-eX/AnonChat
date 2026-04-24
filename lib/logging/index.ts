/**
 * Secure Logging System - Main Export
 * 
 * This module provides a comprehensive logging system that automatically
 * filters sensitive data while providing detailed system monitoring.
 */

// Core logger functionality
export {
  SecureLogger,
  logger,
  logUtils,
  type LogLevel,
  type LogContext,
  type SecureLogEntry,
  type LoggerConfig
} from './secure-logger';

// Event types and categorization
export {
  LogEvent,
  EventCategory,
  EVENT_CATEGORIES,
  getEventCategory,
  isEventInCategory,
  getEventsInCategory
} from './event-types';

// Middleware for automatic logging
export {
  withLogging,
  withWebSocketLogging,
  withDatabaseLogging,
  withFunctionLogging,
  logErrorBoundary,
  logRateLimitEvent,
  logSecurityEvent,
  logPerformanceMetric
} from './middleware';

// Remote integrations and centralized logging
export {
  ElasticsearchProvider,
  LogstashProvider,
  DatadogProvider,
  HttpProvider,
  CentralizedLogger,
  centralizedLogger,
  createIntegratedLogger,
  createLoggerFromEnvironment,
  envLogger,
  type RemoteLoggingProvider
} from './integrations';

// Default logger instance for immediate use
export { logger as default } from './secure-logger';
