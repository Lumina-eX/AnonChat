# Implementation Plan: Wallet Signature Verification

## Overview

This implementation plan breaks down the wallet signature verification feature into discrete coding tasks. The feature adds cryptographic signature verification to the existing Next.js authentication system, requiring users to prove wallet ownership through Ed25519 signatures before session issuance.

The implementation follows a bottom-up approach: core cryptographic functions first, then API endpoints, then integration, and finally comprehensive testing. Each task builds incrementally on previous work, with checkpoints to validate functionality.

## Tasks

- [x] 1. Set up project structure and dependencies
  - Install @stellar/stellar-sdk and fast-check dependencies
  - Create lib/auth/ directory for authentication utilities
  - Set up WALLET_AUTH_SECRET environment variable in .env.local
  - _Requirements: 6.1, 8.5_

- [ ] 2. Implement signature verification module
  - [x] 2.1 Create lib/auth/stellar-verify.ts with core verification function
    - Implement verifyWalletSignature() using Stellar SDK Keypair.fromPublicKey() and Keypair.verify()
    - Handle Ed25519 signature verification with proper encoding (hex to bytes, UTF-8 message)
    - Add exception handling that catches all SDK errors and returns false
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 8.1, 8.2, 8.3, 8.4_
  
  - [ ]* 2.2 Write property test for signature verification round trip
    - **Property 1: Signature Verification Round Trip**
    - **Validates: Requirements 1.1, 1.2**
  
  - [ ]* 2.3 Write property test for invalid signature rejection
    - **Property 2: Invalid Signatures Are Rejected**
    - **Validates: Requirements 1.4, 9.2**
  
  - [ ]* 2.4 Write property test for signature format handling
    - **Property 4: Signature Format Handling**
    - **Validates: Requirements 1.5, 1.6**
  
  - [ ]* 2.5 Write unit tests for signature verification edge cases
    - Test malformed signatures, invalid wallet addresses, empty inputs
    - Test exception handling when Stellar SDK throws errors
    - _Requirements: 5.5, 8.3_

- [ ] 3. Implement nonce generation and management
  - [x] 3.1 Add nonce storage and generation functions to lib/auth/stellar-verify.ts
    - Implement in-memory Map storage for nonces with expiration timestamps
    - Implement generateNonce() with format "anonchat:{timestamp}:{uuid}"
    - Set 5-minute expiration (300 seconds) from generation time
    - Implement nonce replacement strategy (new nonce replaces old for same wallet)
    - _Requirements: 2.1, 2.2, 2.3, 2.6, 3.6_
  
  - [x] 3.2 Add nonce consumption function to lib/auth/stellar-verify.ts
    - Implement consumeNonce() that retrieves, validates expiration, and deletes nonce
    - Return null for expired or non-existent nonces
    - Ensure one-time use by deleting immediately
    - _Requirements: 2.4, 2.5, 3.1, 3.2, 3.3_
  
  - [ ]* 3.3 Write property test for nonce uniqueness
    - **Property 5: Nonce Uniqueness**
    - **Validates: Requirements 2.1, 2.3**
  
  - [ ]* 3.4 Write property test for nonce expiration time
    - **Property 6: Nonce Expiration Time**
    - **Validates: Requirements 2.2, 3.5**
  
  - [ ]* 3.5 Write property test for nonce one-time use
    - **Property 7: Nonce One-Time Use**
    - **Validates: Requirements 2.4, 3.1, 3.2, 3.3, 9.3**
  
  - [ ]* 3.6 Write property test for nonce-wallet association
    - **Property 8: Nonce-Wallet Association**
    - **Validates: Requirements 2.6**
  
  - [ ]* 3.7 Write property test for nonce replacement strategy
    - **Property 9: Nonce Replacement Strategy**
    - **Validates: Requirements 3.6**
  
  - [ ]* 3.8 Write unit tests for nonce management
    - Test nonce generation produces valid format
    - Test expired nonce returns null
    - Test nonce consumption removes from storage
    - Test concurrent nonce generation for same wallet
    - _Requirements: 2.1, 2.4, 2.5, 3.6_

- [ ] 4. Checkpoint - Verify core cryptographic functions
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement deterministic password generation
  - [x] 5.1 Create lib/auth/password.ts with deterministicPassword function
    - Implement HMAC-SHA256 password derivation using Web Crypto API
    - Validate WALLET_AUTH_SECRET environment variable is set
    - Return 64-character hex string
    - Throw error if WALLET_AUTH_SECRET is missing
    - _Requirements: 4.6, 6.1, 6.2, 6.3_
  
  - [ ]* 5.2 Write property test for deterministic password generation
    - **Property 10: Deterministic Password Generation**
    - **Validates: Requirements 4.6, 6.3**
  
  - [ ]* 5.3 Write unit tests for password derivation
    - Test same wallet produces same password
    - Test different wallets produce different passwords
    - Test missing WALLET_AUTH_SECRET throws error
    - Test output is 64-character hex string
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 6. Implement input validation utilities
  - [x] 6.1 Create lib/auth/validation.ts with wallet address validation
    - Implement validateStellarAddress() that checks 56 characters starting with 'G'
    - Implement validateRequiredFields() for request body validation
    - Return descriptive error messages for each validation failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [ ]* 6.2 Write property test for wallet address format validation
    - **Property 12: Wallet Address Format Validation**
    - **Validates: Requirements 5.4**
  
  - [ ]* 6.3 Write unit tests for input validation
    - Test valid Stellar addresses pass
    - Test invalid formats fail with correct error messages
    - Test missing required fields return appropriate errors
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 7. Implement POST /api/auth/nonce endpoint
  - [x] 7.1 Create app/api/auth/nonce/route.ts
    - Implement POST handler that validates walletAddress
    - Call generateNonce() and return nonce in response
    - Add error handling for validation failures (400) and internal errors (500)
    - Add logging for nonce generation
    - _Requirements: 2.1, 2.2, 2.3, 5.1, 5.3, 5.4, 7.5_
  
  - [ ]* 7.2 Write unit tests for /api/auth/nonce endpoint
    - Test valid wallet address returns nonce
    - Test missing walletAddress returns 400
    - Test invalid wallet format returns 400
    - Test response format matches API contract
    - _Requirements: 5.1, 5.3, 5.4, 7.5_

- [ ] 8. Implement POST /api/auth/wallet-login endpoint
  - [x] 8.1 Create app/api/auth/wallet-login/route.ts with input validation
    - Validate walletAddress and signature are present
    - Return 400 with descriptive error messages for missing fields
    - _Requirements: 5.1, 5.2, 7.1, 7.3_
  
  - [x] 8.2 Add nonce consumption logic to wallet-login endpoint
    - Call consumeNonce() before signature verification
    - Return 401 "Nonce not found or expired" if nonce is invalid
    - Ensure nonce is deleted before verification (one-time use)
    - _Requirements: 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 7.2_
  
  - [x] 8.3 Add signature verification logic to wallet-login endpoint
    - Call verifyWalletSignature() with wallet address, nonce, and signature
    - Return 401 "Signature verification failed" if verification fails
    - Proceed to session issuance only if verification succeeds
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 7.1_
  
  - [x] 8.4 Add Supabase authentication integration
    - Generate deterministic email: {walletAddress.toLowerCase()}@wallet.anonchat.local
    - Call deterministicPassword() to get password
    - Attempt signInWithPassword(), fallback to signUp() for new users
    - Set user metadata with wallet_address and username format
    - Skip email confirmation (emailRedirectTo: undefined)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.4, 6.5_
  
  - [x] 8.5 Add response formatting and error handling
    - Return 200 with session, user, walletAddress, isNewUser: false for existing users
    - Return 201 with session, user, walletAddress, isNewUser: true for new users
    - Add comprehensive error handling with appropriate status codes
    - Add security logging for all authentication failures
    - _Requirements: 4.3, 4.4, 5.6, 6.6, 7.4_
  
  - [ ]* 8.6 Write property test for valid signatures leading to session issuance
    - **Property 3: Valid Signatures Lead to Session Issuance**
    - **Validates: Requirements 1.3, 4.1, 4.2, 4.3**
  
  - [ ]* 8.7 Write property test for user metadata storage
    - **Property 11: User Metadata Storage**
    - **Validates: Requirements 4.5**
  
  - [ ]* 8.8 Write property test for exception handling in verification
    - **Property 13: Exception Handling in Verification**
    - **Validates: Requirements 5.5, 8.3**
  
  - [ ]* 8.9 Write property test for wallet address normalization
    - **Property 14: Wallet Address Normalization**
    - **Validates: Requirements 6.4**
  
  - [ ]* 8.10 Write property test for email confirmation bypass
    - **Property 15: Email Confirmation Bypass**
    - **Validates: Requirements 6.5**
  
  - [ ]* 8.11 Write property test for authentication failure logging
    - **Property 16: Authentication Failure Logging**
    - **Validates: Requirements 6.6**
  
  - [ ]* 8.12 Write property test for processing order enforcement
    - **Property 17: Processing Order Enforcement**
    - **Validates: Requirements 7.1, 7.2, 7.3**
  
  - [ ]* 8.13 Write property test for early return on validation failure
    - **Property 18: Early Return on Validation Failure**
    - **Validates: Requirements 7.4**
  
  - [ ]* 8.14 Write property test for API contract preservation
    - **Property 19: API Contract Preservation**
    - **Validates: Requirements 7.5**
  
  - [ ]* 8.15 Write property test for Stellar SDK method usage
    - **Property 20: Stellar SDK Method Usage**
    - **Validates: Requirements 8.1, 8.2**
  
  - [ ]* 8.16 Write unit tests for /api/auth/wallet-login endpoint
    - Test successful authentication with valid signature (200)
    - Test new user creation (201)
    - Test invalid signature returns 401
    - Test expired nonce returns 401
    - Test reused nonce returns 401
    - Test missing fields return 400
    - Test internal errors return 500
    - Test error messages match specification
    - _Requirements: 1.4, 2.5, 3.3, 3.4, 4.3, 4.4, 5.1, 5.2, 5.6_

- [ ] 9. Checkpoint - Verify API endpoints work correctly
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Add integration tests for complete authentication flow
  - [ ]* 10.1 Write integration test for successful authentication flow
    - Test complete flow: generate nonce → sign with wallet → authenticate → receive session
    - Verify JWT token is valid and contains correct claims
    - Verify user metadata includes wallet address
    - _Requirements: 9.1_
  
  - [ ]* 10.2 Write integration test for replay attack prevention
    - Test that reusing a nonce fails with 401
    - Verify nonce is deleted after first use
    - _Requirements: 9.3_
  
  - [ ]* 10.3 Write integration test for nonce expiration
    - Test that expired nonce (>5 minutes) fails with 401
    - Mock time to simulate expiration
    - _Requirements: 2.5, 3.4_
  
  - [ ]* 10.4 Write integration test for concurrent nonce generation
    - Test that generating new nonce replaces old nonce
    - Verify old nonce becomes invalid
    - _Requirements: 3.6_

- [ ] 11. Add TypeScript type definitions and documentation
  - [-] 11.1 Create types for all request/response interfaces
    - Define NonceRequest, NonceResponse, WalletLoginRequest, WalletLoginResponse
    - Define ErrorResponse interface
    - Export types from lib/auth/types.ts
    - _Requirements: 7.5, 7.6_
  
  - [ ] 11.2 Add JSDoc comments to all exported functions
    - Document parameters, return values, and error conditions
    - Add usage examples for key functions
    - Document security considerations
    - _Requirements: 7.5_

- [ ] 12. Final verification and cleanup
  - [ ] 12.1 Run build and lint checks
    - Execute npm run build and verify no errors
    - Execute npm run lint and verify no errors
    - Fix any TypeScript compilation errors
    - _Requirements: 9.4, 9.5_
  
  - [ ] 12.2 Verify no regressions in existing features
    - Test wallet connection flow still works
    - Test message rendering still works
    - Test navigation still works
    - _Requirements: 9.6_
  
  - [ ] 12.3 Add environment variable documentation
    - Document WALLET_AUTH_SECRET in README or .env.example
    - Add setup instructions for local development
    - Document security requirements (minimum 32 characters)
    - _Requirements: 6.1, 6.2_

- [ ] 13. Final checkpoint - Complete verification
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property-based tests use fast-check with minimum 100 iterations
- All property tests are annotated with their property number and validated requirements
- Implementation uses TypeScript as specified in the design document
- Checkpoints ensure incremental validation at key milestones
- Testing strategy combines unit tests (specific examples) and property tests (universal properties)
- Core implementation follows bottom-up approach: crypto → storage → API → integration
