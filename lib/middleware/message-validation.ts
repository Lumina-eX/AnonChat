/**
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

// Validation error types
export enum ValidationErrorType {
  EMPTY_MESSAGE = 'EMPTY_MESSAGE',
  MESSAGE_TOO_LONG = 'MESSAGE_TOO_LONG',
  INVALID_STRUCTURE = 'INVALID_STRUCTURE',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_FIELD_TYPE = 'INVALID_FIELD_TYPE',
  UNSAFE_CONTENT = 'UNSAFE_CONTENT',
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
    const regex = new RegExp(`${tag}\\b[^<]*(?:(?!<\\/${tag.replace('<', '')})<[^<]*)*`, 'gi');
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
    /(\bOR\b|\bAND\b).*=.*=/gi,
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
 * Validate message payload structure
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
      console.error(`[MessageValidation] Validation failed (${context}):`, {
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
