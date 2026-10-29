/**
 * Input validation utilities for wallet authentication and attachment metadata
 * 
 * This module provides validation functions for wallet addresses and request bodies
 * used in the authentication API endpoints, as well as validation for attachment
 * metadata (filenames, MIME types, and file sizes).
 */

/**
 * Validates a Stellar wallet address format.
 * 
 * A valid Stellar address must:
 * - Be exactly 56 characters long
 * - Start with the letter 'G'
 * 
 * @param address - The wallet address to validate
 * @returns true if the address is valid, false otherwise
 * 
 * @example
 * validateStellarAddress('GABC...XYZ9') // returns true
 * validateStellarAddress('invalid') // returns false
 */
export function validateStellarAddress(address: string): boolean {
  if (typeof address !== 'string') {
    return false;
  }
  
  return address.length === 56 && address.startsWith('G');
}

/**
 * Validation error with descriptive message
 */
export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validates required fields in a request body.
 * 
 * @param body - The request body to validate
 * @param requiredFields - Array of field names that must be present
 * @returns Array of validation errors (empty if all fields are valid)
 * 
 * @example
 * validateRequiredFields({ walletAddress: 'GABC...' }, ['walletAddress', 'signature'])
 * // returns [{ field: 'signature', message: 'signature is required' }]
 */
export function validateRequiredFields(
  body: Record<string, unknown>,
  requiredFields: string[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  
  for (const field of requiredFields) {
    const value = body[field];
    if (!value || typeof value !== 'string' || value.trim() === '') {
      errors.push({
        field,
        message: `${field} is required`
      });
    }
  }
  
  return errors;
}

/**
 * Validates a wallet address and returns a descriptive error message if invalid.
 * 
 * @param walletAddress - The wallet address to validate
 * @returns Error message if invalid, null if valid
 * 
 * @example
 * validateWalletAddressWithMessage('GABC...XYZ9') // returns null
 * validateWalletAddressWithMessage('invalid') // returns 'Invalid Stellar wallet address'
 */
export function validateWalletAddressWithMessage(walletAddress: string): string | null {
  if (!walletAddress || typeof walletAddress !== 'string') {
    return 'walletAddress is required';
  }
  
  if (!validateStellarAddress(walletAddress)) {
    return 'Invalid Stellar wallet address';
  }
  
  return null;
}

/** ******************************************************************************
 * Attachment metadata validation
 * *******************************************************************************/

/**
 * Maximum allowed file size for attachment metadata (25 MiB).
 */
export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

/**
 * Maximum allowed length for an original filename.
 */
export const MAX_ATTACHMENT_FILENAME_LENGTH = 255;

/**
 * MIME types explicitly rejected for attachment metadata.
 * These are typically executable or active content types that should not be
 * shared as group attachments.
 */
export const BLOCKED_MIME_TYPES: readonly string[] = [
  'application/x-msidown',
  'application/x-msilk',
  'application/x-msdos-exe',
  'application/x-executable',
  'application/x-sh',
  'application/x-bat',
  'application/x-csh',
  'application/x-python-code',
  'application/x-javascript',
  'application/javascript',
  'text/javascript',
  'text/html',
  'application/xhtml+xml',
];

/**
 * Regular expression for a valid MIME type (type/subtype with optional parameters).
 */
const MIME_TYPE_PATTERN = /^[a-z0-9!#$&-^_+]+\/[a-z0-9!#$&-^_+.]+(?:\s*;\s*[a-z0-9!#$&-^_+]+=(?:[^;\s]+))*$/i;

/**
 * Regular expression for control characters that are not allowed in filenames.
 */
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;

/**
 * Regular expression for path traversal sequences in filenames.
 */
const PATH_TRAVERSAL_PATTERN = /(?:\.\.|[\/\\])/;

/**
 * Validates an original attachment filename.
 *
 * A valid filename:
 * - Is a non-empty string
 * - Does not exceed MAX_ATTACHMENT_FILENAME_LENGTH characters
 * - Does not contain control characters
 * - Does not contain path traversal sequences or path separators
 * - Is not ".", "..", or an empty/whitespace-only name
 *
 * @param filename - The filename to validate
 * @returns Error message if invalid, null if valid
 */
export function validateAttachmentFilename(filename: string): string | null {
  if (!filename || typeof filename !== 'string') {
    return 'filename is required';
  }

  const trimmed = filename.trim();
  if (trimmed === '') {
    return 'filename is required';
  }

  if (trimmed.length > MAX_ATTACHMENT_FILENAME_LENGTH) {
    return `filename must not exceed ${MAX_ATTACHMENT_FILENAME_LENGTH} characters`;
  }

  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    return 'filename contains invalid control characters';
  }

  if (PATH_TRAVERSAL_PATTERN.test(trimmed)) {
    return 'filename must not contain path separators or traversal sequences';
  }

  if (trimmed === '.' || trimmed === '..') {
    return 'filename is invalid';
  }

  return null;
}

/**
 * Validates an attachment MIME type.
 *
 * A valid MIME type:
 * - Is a non-empty string in "type/subtype" format
 * - Is canonicalized to lowercase for comparison
 * - Is not in the BLOCKED_MIME_TYPES list
 *
 * @param mimeType - The MIME type to validate
 * @returns Error message if invalid, null if valid
 */
export function validateAttachmentMimeType(mimeType: string): string | null {
  if (!mimeType || typeof mimeType !== 'string') {
    return 'mimeType is required';
  }

  const trimmed = mimeType.trim();
  if (trimmed === '') {
    return 'mimeType is required';
  }

  if (!MIME_TYPE_PATTERN.test(trimmed)) {
    return 'Invalid MIME type format';
  }

  const baseType = trimmed.split(';')[0].trim().toLowerCase();
  if (BLOCKED_MIME_TYPES.includes(baseType)) {
    return 'Unsupported MIME type';
  }

  return null;
}

/**
 * Validates an attachment file size in bytes.
 *
 * A valid file size:
 * - Is a finite integer
 * - Is greater than zero
 * - Does not exceed MAX_ATTACHMENT_SIZE_BYTES
 *
 * @param sizeBytes - The file size in bytes to validate
 * @returns Error message if invalid, null if valid
 */
export function validateAttachmentSize(sizeBytes: number): string | null {
  if (typeof sizeBytes !== 'number' || !isFinite(sizeBytes)) {
    return 'sizeBytes is required';
  }

  if (!Number.isInteger(sizeBytes)) {
    return 'sizeBytes must be an integer';
  }

  if (sizeBytes <= 0) {
    return 'sizeBytes must be greater than zero';
  }

  if (sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return 'File size exceeds the maximum allowed size';
  }

  return null;
}

/**
 * Attachment metadata input shape used for validation.
 */
export interface AttachmentMetadataInput {
  messageId?: string;
  groupId?: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  uploaderId?: string;
  [key: string]: unknown;
}

/**
 * Fields that must NOT appear in attachment metadata payloads.
 * These represent file contents or sensitive cryptographic material.
 */
export const FORBIDDEN_ATTACHMENT_FIELDS: readonly string[] = [
  'content',
  'fileContent',
  'fileContents',
  'data',
  'body',
  'encryptedContent',
  'encryptionKey',
  'encryptionKeys',
  'key',
  'keys',
  'secret',
  'secrets',
  'privateKey',
  'privateKeys',
  'decryptionKey',
  'decryptionKeys',
  'iv',
  'salt',
  'passphrase',
  'ciphertext',
];

/**
 * Detects forbidden fields (file contents or cryptographic material) in a
 * provided attachment metadata payload.
 *
 * @param payload - The attachment metadata payload to inspect
 * @returns Array of validation errors for each forbidden field present
 */
export function validateNoForbiddenAttachmentFields(
  payload: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!payload || typeof payload !== 'object') {
    return errors;
  }

  for (const field of FORBIDDEN_ATTACHMENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      errors.push({
        field,
        message: `${field} is not allowed in attachment metadata`
      });
    }
  }

  return errors;
}

/**
 * Validates a complete attachment metadata creation payload.
 *
 * Enforces required fields, filename format, MIME type support, file size
 * limits, and rejection of file contents or cryptographic material.
 *
 * @param payload - The attachment metadata payload to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateAttachmentMetadata(
  payload: AttachmentMetadataInput
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!payload || typeof payload !== 'object') {
    return [{ field: 'body', message: 'request body is required' }];
  }

  errors.push(...validateNoForbiddenAttachmentFields(payload as Record<string, unknown>));

  const requiredStringFields: Array<keyof AttachmentMetadataInput> = [
    'messageId',
    'groupId',
    'filename',
    'mimeType',
    'uploaderId',
  ];

  for (const field of requiredStringFields) {
    const value = payload[field];
    if (!value || typeof value !== 'string' || value.trim() === '') {
      errors.push({ field, message: `${field} is required` });
    }
  }

  if (typeof payload.sizeBytes === 'undefined' || payload.sizeBytes === null) {
    errors.push({ field: 'sizeBytes', message: 'sizeBytes is required' });
  } else {
    const sizeError = validateAttachmentSize(payload.sizeBytes as number);
    if (sizeError) {
      errors.push({ field: 'sizeBytes', message: sizeError });
    }
  }

  if (typeof payload.filename === 'string' && payload.filename.trim() !== '') {
    const filenameError = validateAttachmentFilename(payload.filename);
    if (filenameError) {
      errors.push({ field: 'filename', message: filenameError });
    }
  }

  if (typeof payload.mimeType === 'string' && payload.mimeType.trim() !== '') {
    const mimeError = validateAttachmentMimeType(payload.mimeType);
    if (mimeError) {
      errors.push({ field: 'mimeType', message: mimeError });
    }
  }

  if (typeof payload.uploaderId === 'string' && payload.uploaderId.trim() !== '') {
    const uploaderError = validateWalletAddressWithMessage(payload.uploaderId);
    if (uploaderError) {
      errors.push({ field: 'uploaderId', message: uploaderError });
    }
  }

  return errors;
}
