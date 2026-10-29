/*
 * Message Validation Middleware
 * 
 * Validates incoming messages to ensure data integrity, security, and consistent user experience.
 * This prevents malformed, oversized, or unsafe content from entering the system.
 */

// Configuration
export const MESSAGE_VALIDATION_CONFIG = {
  MAX_message_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH || '2000', 10),
  MIN_message_LENGTH: 1,
  ALLOWED_MESSAGE_TYPES: ['send_message', 'edit_message'],
} as const;

// Attachment metadata configuration
export const ATTACHMENT_VALIDATION_CONFIG = {
  // Maximum attachment size in bytes (default 25 MiB)
  MAX_FILE_SIZE: parseInt(process.env.MAX_ATTACHMENT_SIZE || String(25 * 1024 * 1024), 10),
  // Maximum filename length
  MAX_FILENAME_LENGTH: parseInt(process.env.MAX_ATTACHMENT_FILENAME_LENGTH || '255', 10),
  // Allowed MIME types (common safe attachment types)
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/json',
    'application/zip',
    'application/mcstream',
    'application/vnd.opendocument.text',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/mpeg',
    'audio/mp4',
    'video/mp4',
  ],
} as const;

// Validation error types
export enum ValidationErrorType {
  EMPTY_MESSAGE = 'EMPTY_MESSAGE',
  MESSAGE_TOO_LONG = 'MESSAGE_TOO_LONG',
  INVALID_STRUCTURE = 'INVALID_STRUCTURE',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FIELD_TYPE = 'INVALID_FIELD_TYPE',
  UNSAFE_CONTENT = 'UNSAFE_CONTENT',
  // Attachment-metadata specific error types
  INVALID_FILENAME = 'INVALID_FILENAME',
  UNSUPPORTED_MIME_TYPE = 'UNSUPPORTED_MIME_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  INVALID_FILE_SIZE = 'INVALID_FILE_SIZE',
  SENSITIVE_DATA_PRESENT = 'SENSITIVE_DATA_PRESENT',
}

// Validation error class
export class MessageValidationError extends Error {
  constructor(
    public type: ValidationErrorType,
    message: string,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'MessageValidationError';
  }
}

// Validation metrics
interface ValidationMetrics {
  totalValidations: number;
  validationFailures: Map<ValidationErrorType, number>;
}

const metrics: ValidationMetrics = {
  totalValidations: 0,
  validationFailures: new Map(),
};

/**
 * Sanitize input by removing or escaping potentially harmful content
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FIELD_TYPE,
      'Input must be a string'
    );
  }

  let sanitized = input;

  // Remove script tags and their content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove other potentially dangerous HTML tags
  const dangerousTags = ['<iframe', '<object', '<embed', '<form', '<input', '<button'];
  dangerousTags.forEach(tag => {
    const regex = new RegExp(`${tag}\\b[^<]*(?:(?!<\\/${tag.replace('<', '')})<[^<]*`, 'gi');
    sanitized = sanitized.replace(regex, '');
  });

  // Escape HTML entities to prevent XSS
  sanitized = sanitized
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

  // Basic SQL injection pattern detection (for logging, not prevention)
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|ALTER|CREATE|TRUNCATE)\b)/gi,
    /(--|;|\/\*|\*\/)/g,
    /(\bOR\b)\bAND\b\b.*=.*=/gi,
  ];

  sqlPatterns.forEach(pattern => {
    if (pattern.test(sanitized)) {
      console.warn('[MessageValidation] Potential SQL injection pattern detected');
    }
  });

  return sanitized;
}

/**
 * Check if message is empty or whitespace-only
 */
export function isEmptyMessage(content: string): boolean {
  if (typeof content !== 'string') {
    return true;
  }
  return content.trim().length === 0;
}

/**
 * Check if message exceeds maximum length
 */
export function isMessageTooLong(content: string): boolean {
  if (typeof content !== 'string') {
    return true;
  }
  return content.length > MESSAGE_VALIDATION_CONFIG.MAX_message_LENGTH;
}

/**
 * Validate message payload stucture
 */
export function validateMessageStructure(payload: Record<string, any>, requiredFields: string[]): void {
  for (const field of requiredFields) {
    if (!(field in payload)) {
      throw new MessageValidationError(
        ValidationErrorType.MISSING_REQUIRED_FIELD,
        `Missing required field: ${field}`,
        { field }
      );
    }
  }
}

/**
 * Validate field types
 */
export function validateFieldTypes(payload: Record<string, any>, fieldTypes: Record<string, string>): void {
  for (const [field, expectedType] of Object.entries(fieldTypes)) {
    if (field in payload) {
      const actualType = typeof payload[field];
      if (actualType !== expectedType) {
        throw new MessageValidationError(
          ValidationErrorType.INVALID_FIELD_TYPE,
          `Invalid type for field ${field}: expected ${expectedType}, got ${actualType}`,
          { field, expectedType, actualType }
        );
      }
    }
  }
}

/**
 * Main message validation function
 */
export function validateMessage(payload: Record<string, any>, context: 'http' | 'websocket' = 'http'): {
  isValid: boolean;
  error?: MessageValidationError;
  sanitized?: Record<string, any>;
} {
  metrics.totalValidations++;

  try {
    // Define required fields based on context
    const requiredFields = ['content'];
    const fieldTypes = {
      content: 'string',
      roomId: 'string',
      id: 'string',
      // idempotency_key is an optional UUID string — validated for format
      // separately in the idempotency layer; here we only check the type.
      idempotency_key: 'string',
    };

    // Validate structure
    validateMessageStructure(payload, requiredFields);

    // Validate field types
    validateFieldTypes(payload, fieldTypes);

    const content = payload.content;

    // Check for empty message
    if (isEmptyMessage(content)) {
      throw new MessageValidationError(
        ValidationErrorType.EMPTY_MESSAGE,
        'Message cannot be empty or whitespace-only'
      );
    }

    // Check message length
    if (isMessageTooLong(content)) {
      throw new MessageValidationError(
        ValidationErrorType.MESSAGE_TOO_LONG,
        `Message exceeds maximum length of ${MESSAGE_VALIDATION_CONFIG.MAX_message_LENGTH} characters`,
        { maxLength: MESSAGE_VALIDATION_CONFIG.MAX_message_LENGTH, actualLength: content.length }
      );
    }

    // Sanitize content
    const sanitizedContent = sanitizeInput(content);

    // Return sanitized payload
    return {
      isValid: true,
      sanitized: {
        ...payload,
        content: sanitizedContent,
      },
    };
  } catch (error) {
    if (error instanceof MessageValidationError) {
      // Track failure metrics
      const currentCount = metrics.validationFailures.get(error.type) || 0;
      metrics.validationFailures.set(error.type, currentCount + 1);

      // Log validation failure
      console.error(`[MessageValidation] Validation failed (${context})::`, {
        type: error.type,
        message: error.message,
        details: error.details,
      });

      return {
        isValid: false,
        error,
      };
    }

    // Unexpected error
    console.error('[MessageValidation] Unexpected error:', error);
    return {
      isValid: false,
      error: new MessageValidationError(
        ValidationErrorType.INVALID_STRUCTURE,
        'Unexpected validation error'
      ),
    };
  }
}

/**
 * Get validation metrics
 */
export function getValidationMetrics(): ValidationMetrics {
  return {
    totalValidations: metrics.totalValidations,
    validationFailures: new Map(metrics.validationFailures),
  };
}

/**
 * Reset validation metrics (useful for testing)
 */
export function resetValidationMetrics(): void {
  metrics.totalValidations = 0;
  metrics.validationFailures.clear();
}

/**
 * Express/Next.js middleware wrapper for HTTP endpoints
 */
export function messageValidationMiddleware(requiredFields?: string[]) {
  return (req: any, res: any, next: any) => {
    try {
      const body = req.body;
      
      const validation = validateMessage(body, 'http');
      
      if (!validation.isValid) {
        return res.status(400).json({
          error: 'Message validation failed',
          type: validation.error?.type,
          message: validation.error?.message,
          details: validation.error?.details,
        });
      }

      // Replace request body with sanitized version
      req.body = validation.sanitized || body;
      
      next();
    } catch (error) {
      console.error('[MessageValidation] Middleware error:', error);
      return res.status(500).json({
        error: 'Validation middleware error',
      });
    }
  };
}

// ----------------------------------------------------------------------------
// Attachment Metadata Validation
// ----------------------------------------------------------------------------

/**
 * Attachment metadata payload shape. Contains only non-sensitive metadata;
 * file contents and encryption keys must never be included.
 */
export interface AttachmentMetadataPayload {
  attachmentId?: string;
  messageId: string;
  groupId: string;
  filename: string;
  mimeType: string;
  size: number;
  uploaderId: string;
  uploadedAt?: string | Date;
}

/**
 * Fields that must NEVER appear in attachment metadata records.
 * This guard prevents file contents and cryptographic material from being persisted.
 */
export const FORBIDDEN_ATTACHMENT_FIELDS: readonly string[] = [
  'content',
  'fileContent',
  'data',
  'binary',
  'buffer',
  'encryptionKey',
  'encryptionKeyId',
  'key',
  'keys',
  'secret',
  'secrets',
  'privateKey',
  'publicKey',
  'ivInitVector',
  'iv',
  'ciphertext',
  'salt',
  'passphrase',
  'password',
  'token',
] as const;

/**
 * Validate a filename for attachment metadata.
 * Rejects empty, overly long, path-traversal, control-character, and
 * reserved-path filenames.
 */
export function validateAttachmentFilename(filename: unknown): string {
  if (typeof filename !== 'string') {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FIELD_TYPE,
      'Filename must be a string',
      { field: 'filename' }
    );
  }

  const trimmed = filename.trim();

  if (trimmed.length === 0) {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FILENAME,
      'Filename cannot be empty',
      { field: 'filename' }
    );
  }

  if (trimmed.length > ATTACHMENT_VALIDATION_CONFIG.MAX_FILENAME_LENGTH) {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FILENAME,
      `Filename exceeds maximum length of ${ATTACHMENT_VALIDATION_CONFIG.MAX_FILENAME_LENGTH} characters`,
      { maxLength: ATTACHMENT_VALIDATION_CONFIG.MAX_FILENAME_LENGTH, actualLength: trimmed.length }
    );
  }

  // Reject path traversal and path separators
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FILENAME,
      'Filename contains illegal path characters',
      { field: 'filename' }
    );
  }

  // Reject control characters and null bytes
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FILENAME,
      'Filename contains illegal control characters',
      { field: 'filename' }
    );
  }

  // Reject reserved path names
  const reserved = ['.', '..'];
  if (reserved.includes(trimmed)) {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FILENAME,
      'Filename is a reserved path name',
      { field: 'filename' }
    );
  }

  return trimmed;
}

/**
 * Validate a MIME type against the allow-list.
 */
export function validateAttachmentMimeType(mimeType: unknown): string {
  if (typeof mimeType !== 'string') {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FIELD_TYPE,
      'MIME type must be a string',
      { field: 'mimeType' }
    );
  }

  const normalized = mimeType.trim().toLowerCase();

  if (normalized.length === 0) {
    throw new MessageValidationError(
      ValidationErrorType.UNSUPPORTED_MIME_TYPE,
      'MIME type cannot be empty',
      { field: 'mimeType' }
    );
  }

  if (!(ATTACHMENT_VALIDATION_CONFIG.ALLOWED_MIME_TYPES as readonly string[]).includes(normalized)) {
    throw new MessageValidationError(
      ValidationErrorType.UNSUPPORTED_MIME_TYPE,
      `Unsupported MIME type: ${normalized}`,
      { field: 'mimeType', mimeType: normalized }
    );
  }

  return normalized;
}

/**
 * Validate a file size in bytes.
 */
export function validateAttachmentSize(size: unknown): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FILE_SIZE,
      'File size must be a finite number',
      { field: 'size' }
    );
  }

  if (!Number.isInteger(size) || size <= 0) {
    throw new MessageValidationError(
      ValidationErrorType.INVALID_FILE_SIZE,
      'File size must be a positive integer',
      { field: 'size', size }
    );
  }

  if (size > ATTACHMENT_VALIDATION_CONFIG.MAX_FILE_SIZE) {
    throw new MessageValidationError(
      ValidationErrorType.FILE_TOO_LARGE,
      `File size exceeds maximum of ${ATTACHMENT_VALIDATION_CONFIG.MAX_FILE_SIZE} bytes`,
      { maxSize: ATTACHMENT_VALIDATION_CONFIG.MAX_FILE_SIZE, actualSize: size }
    );
  }

  return size;
}

/**
 * Reject attachment metadata that contains forbidden fields (file contents,
 * encryption keys, secrets, etc.).
 */
export function assertNoSensitiveAttachmentFields(payload: Record<string, any>): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const forbidden = new Set(FORBIDDEN_ATTACHMENT_FIELDS.map(f => f.toLowerCase()));
  const offending = Object.keys(payload).filter(key => forbidden.has(key.toLowerCase()));

  if (offending.length > 0) {
    throw new MessageValidationError(
      ValidationErrorType.SENSITIVE_DATA_PRESENT,
      'Attachment metadata must not contain file contents or cryptographic material',
      { fields: offending }
    );
  }
}

/**
 * Validate and normalize an attachment metadata payload.
 * Returns a clean metadata object containing only approved fields.
 */
export function validateAttachmentMetadata(payload: Record<string, any>): AttachmentMetadataPayload {
  metrics.totalValidations++;

  try {
    if (!payload || typeof payload !== 'object') {
      throw new MessageValidationError(
        ValidationErrorType.INVALID_STRUCTURE,
        'Attachment metadata payload must be an object'
      );
    }

    // Reject file contents and cryptographic material
    assertNoSensitiveAttachmentFields(payload);

    // Required identifier fields
    const requiredStringFields = ['messageId', 'groupId', 'uploaderId'] as const;
    for (const field of requiredStringFields) {
      const value = payload[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new MessageValidationError(
          ValidationErrorType.MISSING_REQUIRED_FIELD,
          `Missing or invalid required field: ${field}`,
          { field }
        );
      }
    }

    const filename = validateAttachmentFilename(payload.filename);
    const mimeType = validateAttachmentMimeType(payload.mimeType);
    const size = validateAttachmentSize(payload.size);

    const result: AttachmentMetadataPayload = {
      messageId: payload.messageId.trim(),
      groupId: payload.groupId.trim(),
      uploaderId: payload['uploaderId'].trim(),
      filename,
      mimeType,
      size,
    };

    if (typeof payload.attachmentId === 'string' && payload.attachmentId.trim().length > 0) {
      result.attachmentId = payload.attachmentId.trim();
    }

    if (payload.uploadedAt !== undefined) {
      result.uploadedAt = payload.uploadedAt;
    }

    return result;
  } catch (error) {
    if (error instanceof MessageValidationError) {
      const currentCount = metrics.validationFailures.get(error.type) || 0;
      metrics.validationFailures.set(error.type, currentCount + 1);
    }
    throw error;
  }
}
