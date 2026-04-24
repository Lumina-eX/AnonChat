/**
 * Standardized event types for consistent logging across the application
 */

export enum LogEvent {
  // Authentication Events
  AUTH_LOGIN = 'auth.login',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_REGISTER = 'auth.register',
  AUTH_WALLET_CONNECT = 'auth.wallet_connect',
  AUTH_WALLET_DISCONNECT = 'auth.wallet_disconnect',
  AUTH_SESSION_CREATED = 'auth.session_created',
  AUTH_SESSION_EXPIRED = 'auth.session_expired',
  AUTH_TOKEN_REFRESH = 'auth.token_refresh',
  AUTH_VALIDATION_FAILED = 'auth.validation_failed',
  AUTH_UNAUTHORIZED = 'auth.unauthorized',

  // API Events
  API_REQUEST = 'api.request',
  API_RESPONSE = 'api.response',
  API_ERROR = 'api.error',
  API_RATE_LIMIT = 'api.rate_limit',
  API_VALIDATION_ERROR = 'api.validation_error',

  // Database Events
  DB_QUERY = 'db.query',
  DB_INSERT = 'db.insert',
  DB_UPDATE = 'db.update',
  DB_DELETE = 'db.delete',
  DB_CONNECTION = 'db.connection',
  DB_ERROR = 'db.error',
  DB_TRANSACTION = 'db.transaction',

  // WebSocket Events
  WS_CONNECT = 'ws.connect',
  WS_DISCONNECT = 'ws.disconnect',
  WS_MESSAGE = 'ws.message',
  WS_ERROR = 'ws.error',
  WS_AUTH = 'ws.authenticate',
  WS_ROOM_JOIN = 'ws.room_join',
  WS_ROOM_LEAVE = 'ws.room_leave',
  WS_RECONNECT = 'ws.reconnect',

  // Room Events
  ROOM_CREATE = 'room.create',
  ROOM_JOIN = 'room.join',
  ROOM_LEAVE = 'room.leave',
  ROOM_DELETE = 'room.delete',
  ROOM_UPDATE = 'room.update',
  ROOM_MEMBER_ADD = 'room.member_add',
  ROOM_MEMBER_REMOVE = 'room.member_remove',
  ROOM_PERMISSION_CHECK = 'room.permission_check',

  // Message Events
  MESSAGE_CREATE = 'message.create',
  MESSAGE_READ = 'message.read',
  MESSAGE_DELETE = 'message.delete',
  MESSAGE_ENCRYPT = 'message.encrypt',
  MESSAGE_DECRYPT = 'message.decrypt',
  MESSAGE_SEND = 'message.send',
  MESSAGE_RECEIVE = 'message.receive',

  // File Events
  FILE_UPLOAD = 'file.upload',
  FILE_DOWNLOAD = 'file.download',
  FILE_DELETE = 'file.delete',
  FILE_PROCESS = 'file.process',
  FILE_ENCRYPT = 'file.encrypt',
  FILE_DECRYPT = 'file.decrypt',

  // Blockchain Events
  BLOCKCHAIN_TRANSACTION = 'blockchain.transaction',
  BLOCKCHAIN_FEE_ESTIMATE = 'blockchain.fee_estimate',
  BLOCKCHAIN_VALIDATION = 'blockchain.validation',
  BLOCKCHAIN_ERROR = 'blockchain.error',
  BLOCKCHAIN_SIGNATURE = 'blockchain.signature',
  BLOCKCHAIN_HASH = 'blockchain.hash',

  // Security Events
  SECURITY_BREACH = 'security.breach',
  SECURITY_SUSPICIOUS_ACTIVITY = 'security.suspicious_activity',
  SECURITY_RATE_LIMIT_EXCEEDED = 'security.rate_limit_exceeded',
  SECURITY_INVALID_TOKEN = 'security.invalid_token',
  SECURITY_PERMISSION_DENIED = 'security.permission_denied',

  // System Events
  SYSTEM_STARTUP = 'system.startup',
  SYSTEM_SHUTDOWN = 'system.shutdown',
  SYSTEM_HEALTH_CHECK = 'system.health_check',
  SYSTEM_MEMORY_USAGE = 'system.memory_usage',
  SYSTEM_CPU_USAGE = 'system.cpu_usage',
  SYSTEM_DISK_USAGE = 'system.disk_usage',

  // Performance Events
  PERFORMANCE_SLOW_QUERY = 'performance.slow_query',
  PERFORMANCE_HIGH_LATENCY = 'performance.high_latency',
  PERFORMANCE_MEMORY_LEAK = 'performance.memory_leak',
  PERFORMANCE_TIMEOUT = 'performance.timeout',

  // Error Events
  ERROR_UNHANDLED = 'error.unhandled',
  ERROR_VALIDATION = 'error.validation',
  ERROR_NETWORK = 'error.network',
  ERROR_TIMEOUT = 'error.timeout',
  ERROR_DATABASE = 'error.database',
  ERROR_EXTERNAL_SERVICE = 'error.external_service',

  // Business Logic Events
  BUSINESS_USER_REGISTRATION = 'business.user_registration',
  BUSINESS_MESSAGE_SENT = 'business.message_sent',
  BUSINESS_ROOM_CREATED = 'business.room_created',
  BUSINESS_FILE_SHARED = 'business.file_shared',
  BUSINESS_REPUTATION_UPDATE = 'business.reputation_update'
}

/**
 * Event categories for grouping and filtering
 */
export enum EventCategory {
  AUTHENTICATION = 'authentication',
  API = 'api',
  DATABASE = 'database',
  WEBSOCKET = 'websocket',
  ROOM = 'room',
  MESSAGE = 'message',
  FILE = 'file',
  BLOCKCHAIN = 'blockchain',
  SECURITY = 'security',
  SYSTEM = 'system',
  PERFORMANCE = 'performance',
  ERROR = 'error',
  BUSINESS = 'business'
}

/**
 * Mapping of events to categories
 */
export const EVENT_CATEGORIES: Record<LogEvent, EventCategory> = {
  [LogEvent.AUTH_LOGIN]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_LOGOUT]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_REGISTER]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_WALLET_CONNECT]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_WALLET_DISCONNECT]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_SESSION_CREATED]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_SESSION_EXPIRED]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_TOKEN_REFRESH]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_VALIDATION_FAILED]: EventCategory.AUTHENTICATION,
  [LogEvent.AUTH_UNAUTHORIZED]: EventCategory.AUTHENTICATION,

  [LogEvent.API_REQUEST]: EventCategory.API,
  [LogEvent.API_RESPONSE]: EventCategory.API,
  [LogEvent.API_ERROR]: EventCategory.API,
  [LogEvent.API_RATE_LIMIT]: EventCategory.API,
  [LogEvent.API_VALIDATION_ERROR]: EventCategory.API,

  [LogEvent.DB_QUERY]: EventCategory.DATABASE,
  [LogEvent.DB_INSERT]: EventCategory.DATABASE,
  [LogEvent.DB_UPDATE]: EventCategory.DATABASE,
  [LogEvent.DB_DELETE]: EventCategory.DATABASE,
  [LogEvent.DB_CONNECTION]: EventCategory.DATABASE,
  [LogEvent.DB_ERROR]: EventCategory.DATABASE,
  [LogEvent.DB_TRANSACTION]: EventCategory.DATABASE,

  [LogEvent.WS_CONNECT]: EventCategory.WEBSOCKET,
  [LogEvent.WS_DISCONNECT]: EventCategory.WEBSOCKET,
  [LogEvent.WS_MESSAGE]: EventCategory.WEBSOCKET,
  [LogEvent.WS_ERROR]: EventCategory.WEBSOCKET,
  [LogEvent.WS_AUTH]: EventCategory.WEBSOCKET,
  [LogEvent.WS_ROOM_JOIN]: EventCategory.WEBSOCKET,
  [LogEvent.WS_ROOM_LEAVE]: EventCategory.WEBSOCKET,
  [LogEvent.WS_RECONNECT]: EventCategory.WEBSOCKET,

  [LogEvent.ROOM_CREATE]: EventCategory.ROOM,
  [LogEvent.ROOM_JOIN]: EventCategory.ROOM,
  [LogEvent.ROOM_LEAVE]: EventCategory.ROOM,
  [LogEvent.ROOM_DELETE]: EventCategory.ROOM,
  [LogEvent.ROOM_UPDATE]: EventCategory.ROOM,
  [LogEvent.ROOM_MEMBER_ADD]: EventCategory.ROOM,
  [LogEvent.ROOM_MEMBER_REMOVE]: EventCategory.ROOM,
  [LogEvent.ROOM_PERMISSION_CHECK]: EventCategory.ROOM,

  [LogEvent.MESSAGE_CREATE]: EventCategory.MESSAGE,
  [LogEvent.MESSAGE_READ]: EventCategory.MESSAGE,
  [LogEvent.MESSAGE_DELETE]: EventCategory.MESSAGE,
  [LogEvent.MESSAGE_ENCRYPT]: EventCategory.MESSAGE,
  [LogEvent.MESSAGE_DECRYPT]: EventCategory.MESSAGE,
  [LogEvent.MESSAGE_SEND]: EventCategory.MESSAGE,
  [LogEvent.MESSAGE_RECEIVE]: EventCategory.MESSAGE,

  [LogEvent.FILE_UPLOAD]: EventCategory.FILE,
  [LogEvent.FILE_DOWNLOAD]: EventCategory.FILE,
  [LogEvent.FILE_DELETE]: EventCategory.FILE,
  [LogEvent.FILE_PROCESS]: EventCategory.FILE,
  [LogEvent.FILE_ENCRYPT]: EventCategory.FILE,
  [LogEvent.FILE_DECRYPT]: EventCategory.FILE,

  [LogEvent.BLOCKCHAIN_TRANSACTION]: EventCategory.BLOCKCHAIN,
  [LogEvent.BLOCKCHAIN_FEE_ESTIMATE]: EventCategory.BLOCKCHAIN,
  [LogEvent.BLOCKCHAIN_VALIDATION]: EventCategory.BLOCKCHAIN,
  [LogEvent.BLOCKCHAIN_ERROR]: EventCategory.BLOCKCHAIN,
  [LogEvent.BLOCKCHAIN_SIGNATURE]: EventCategory.BLOCKCHAIN,
  [LogEvent.BLOCKCHAIN_HASH]: EventCategory.BLOCKCHAIN,

  [LogEvent.SECURITY_BREACH]: EventCategory.SECURITY,
  [LogEvent.SECURITY_SUSPICIOUS_ACTIVITY]: EventCategory.SECURITY,
  [LogEvent.SECURITY_RATE_LIMIT_EXCEEDED]: EventCategory.SECURITY,
  [LogEvent.SECURITY_INVALID_TOKEN]: EventCategory.SECURITY,
  [LogEvent.SECURITY_PERMISSION_DENIED]: EventCategory.SECURITY,

  [LogEvent.SYSTEM_STARTUP]: EventCategory.SYSTEM,
  [LogEvent.SYSTEM_SHUTDOWN]: EventCategory.SYSTEM,
  [LogEvent.SYSTEM_HEALTH_CHECK]: EventCategory.SYSTEM,
  [LogEvent.SYSTEM_MEMORY_USAGE]: EventCategory.SYSTEM,
  [LogEvent.SYSTEM_CPU_USAGE]: EventCategory.SYSTEM,
  [LogEvent.SYSTEM_DISK_USAGE]: EventCategory.SYSTEM,

  [LogEvent.PERFORMANCE_SLOW_QUERY]: EventCategory.PERFORMANCE,
  [LogEvent.PERFORMANCE_HIGH_LATENCY]: EventCategory.PERFORMANCE,
  [LogEvent.PERFORMANCE_MEMORY_LEAK]: EventCategory.PERFORMANCE,
  [LogEvent.PERFORMANCE_TIMEOUT]: EventCategory.PERFORMANCE,

  [LogEvent.ERROR_UNHANDLED]: EventCategory.ERROR,
  [LogEvent.ERROR_VALIDATION]: EventCategory.ERROR,
  [LogEvent.ERROR_NETWORK]: EventCategory.ERROR,
  [LogEvent.ERROR_TIMEOUT]: EventCategory.ERROR,
  [LogEvent.ERROR_DATABASE]: EventCategory.ERROR,
  [LogEvent.ERROR_EXTERNAL_SERVICE]: EventCategory.ERROR,

  [LogEvent.BUSINESS_USER_REGISTRATION]: EventCategory.BUSINESS,
  [LogEvent.BUSINESS_MESSAGE_SENT]: EventCategory.BUSINESS,
  [LogEvent.BUSINESS_ROOM_CREATED]: EventCategory.BUSINESS,
  [LogEvent.BUSINESS_FILE_SHARED]: EventCategory.BUSINESS,
  [LogEvent.BUSINESS_REPUTATION_UPDATE]: EventCategory.BUSINESS
};

/**
 * Get the category for an event
 */
export function getEventCategory(event: LogEvent): EventCategory {
  return EVENT_CATEGORIES[event];
}

/**
 * Check if an event belongs to a specific category
 */
export function isEventInCategory(event: LogEvent, category: EventCategory): boolean {
  return getEventCategory(event) === category;
}

/**
 * Get all events in a specific category
 */
export function getEventsInCategory(category: EventCategory): LogEvent[] {
  return Object.entries(EVENT_CATEGORIES)
    .filter(([, cat]) => cat === category)
    .map(([event]) => event as LogEvent);
}
