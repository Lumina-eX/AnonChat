# Requirements Document

## Introduction

This document specifies requirements for strengthening authentication through cryptographic wallet signature verification. The system validates wallet signatures on the server before issuing JWTs or sessions, ensuring only valid, signed requests can establish authenticated sessions. This enhancement builds upon the existing Stellar wallet integration in the Next.js application with Supabase backend.

## Glossary

- **Wallet_Address**: A Stellar public key (56-character string starting with 'G') that uniquely identifies a wallet
- **Signature**: A cryptographic signature produced by a wallet's private key, encoded as a hexadecimal string
- **Nonce**: A one-time cryptographic token used to prevent replay attacks, valid for a limited time period
- **Authentication_Server**: The Next.js API routes in app/api/auth/ that handle wallet-based authentication
- **Signature_Verifier**: The cryptographic verification component that validates wallet signatures using Ed25519/secp256k1 algorithms
- **Session_Manager**: The Supabase authentication system that issues and manages JWT tokens and sessions
- **Replay_Attack**: An attack where a valid signature is captured and reused to gain unauthorized access
- **JWT**: JSON Web Token used for maintaining authenticated sessions

## Requirements

### Requirement 1: Cryptographic Signature Verification

**User Story:** As a security engineer, I want the server to cryptographically verify wallet signatures, so that only users who control the private key can authenticate.

#### Acceptance Criteria

1. WHEN a wallet login request is received with a Wallet_Address and Signature, THE Signature_Verifier SHALL validate the Signature using the Ed25519 algorithm
2. THE Signature_Verifier SHALL verify that the Signature was produced by signing the Nonce with the private key corresponding to the Wallet_Address
3. WHEN the Signature is valid, THE Authentication_Server SHALL proceed to session issuance
4. WHEN the Signature is invalid, THE Authentication_Server SHALL return a 401 Unauthorized response with error message "Signature verification failed"
5. THE Signature_Verifier SHALL decode the Signature from hexadecimal format before verification
6. THE Signature_Verifier SHALL encode the Nonce message as UTF-8 bytes before verification

### Requirement 2: Nonce Generation and Management

**User Story:** As a security engineer, I want nonces to be cryptographically random and time-limited, so that replay attacks are prevented.

#### Acceptance Criteria

1. WHEN a nonce request is received with a valid Wallet_Address, THE Authentication_Server SHALL generate a cryptographically random Nonce
2. THE Authentication_Server SHALL store the Nonce with an expiration timestamp of 5 minutes from generation
3. THE Nonce SHALL include a timestamp and random UUID component to ensure uniqueness
4. WHEN a Nonce is consumed during authentication, THE Authentication_Server SHALL delete it from storage immediately
5. WHEN a Nonce has expired, THE Authentication_Server SHALL treat it as invalid and return a 401 Unauthorized response
6. THE Authentication_Server SHALL associate each Nonce with exactly one Wallet_Address

### Requirement 3: Replay Attack Prevention

**User Story:** As a security engineer, I want to prevent replay attacks, so that captured signatures cannot be reused for unauthorized access.

#### Acceptance Criteria

1. THE Authentication_Server SHALL allow each Nonce to be used exactly once for authentication
2. WHEN a Nonce is consumed, THE Authentication_Server SHALL remove it from storage before signature verification
3. WHEN an authentication request uses an already-consumed Nonce, THE Authentication_Server SHALL return a 401 Unauthorized response with error message "Nonce not found or expired"
4. WHEN an authentication request uses an expired Nonce, THE Authentication_Server SHALL return a 401 Unauthorized response with error message "Nonce not found or expired"
5. THE Authentication_Server SHALL enforce Nonce expiration of 5 minutes maximum
6. WHEN a new Nonce is generated for a Wallet_Address that already has an active Nonce, THE Authentication_Server SHALL replace the old Nonce with the new one

### Requirement 4: JWT and Session Issuance

**User Story:** As a user, I want to receive a valid session token after successful authentication, so that I can access protected resources.

#### Acceptance Criteria

1. WHEN signature verification succeeds, THE Session_Manager SHALL issue a JWT token for the authenticated Wallet_Address
2. THE Session_Manager SHALL create a Supabase session associated with the Wallet_Address
3. THE Authentication_Server SHALL return the session token, user object, and Wallet_Address in the response with status 200
4. WHEN the Wallet_Address is authenticating for the first time, THE Session_Manager SHALL create a new user account and return status 201
5. THE Session_Manager SHALL store the Wallet_Address in the user metadata
6. THE Session_Manager SHALL generate a deterministic email and password derived from the Wallet_Address for Supabase authentication

### Requirement 5: Input Validation and Error Handling

**User Story:** As a developer, I want clear error messages for invalid requests, so that I can debug authentication issues quickly.

#### Acceptance Criteria

1. WHEN a wallet login request is missing the Wallet_Address field, THE Authentication_Server SHALL return a 400 Bad Request response with error message "walletAddress is required"
2. WHEN a wallet login request is missing the Signature field, THE Authentication_Server SHALL return a 400 Bad Request response with error message "signature is required"
3. WHEN a nonce request is missing the Wallet_Address field, THE Authentication_Server SHALL return a 400 Bad Request response with error message "walletAddress is required"
4. WHEN a Wallet_Address does not match the Stellar format (56 characters starting with 'G'), THE Authentication_Server SHALL return a 400 Bad Request response with error message "Invalid Stellar wallet address"
5. WHEN signature verification throws an exception, THE Signature_Verifier SHALL catch it and return false
6. WHEN any internal error occurs, THE Authentication_Server SHALL return a 500 Internal Server Error response and log the error details

### Requirement 6: Security Compliance

**User Story:** As a security engineer, I want the authentication system to follow security best practices, so that the application is protected against common attacks.

#### Acceptance Criteria

1. THE Authentication_Server SHALL require the WALLET_AUTH_SECRET environment variable to be set for deterministic password generation
2. WHEN WALLET_AUTH_SECRET is not set, THE Authentication_Server SHALL throw an error and refuse to process authentication requests
3. THE Authentication_Server SHALL use HMAC-SHA256 for deriving deterministic passwords from Wallet_Addresses
4. THE Authentication_Server SHALL normalize Wallet_Addresses to lowercase before creating deterministic emails
5. THE Session_Manager SHALL skip email confirmation for wallet-based authentication since signature verification proves ownership
6. THE Authentication_Server SHALL log all authentication failures with sufficient detail for security monitoring

### Requirement 7: Middleware Integration

**User Story:** As a developer, I want signature verification integrated into the authentication flow, so that all authentication requests are validated consistently.

#### Acceptance Criteria

1. THE Authentication_Server SHALL execute signature verification before any session issuance logic
2. THE Authentication_Server SHALL execute nonce consumption before signature verification
3. THE Authentication_Server SHALL execute input validation before nonce consumption
4. WHEN any validation step fails, THE Authentication_Server SHALL halt processing and return an error response immediately
5. THE Authentication_Server SHALL maintain the existing API contract for /api/auth/nonce and /api/auth/wallet-login endpoints
6. THE Authentication_Server SHALL preserve compatibility with existing client-side wallet connection flows

### Requirement 8: Wallet SDK Integration

**User Story:** As a developer, I want to use the Stellar SDK for signature verification, so that cryptographic operations are handled by well-tested libraries.

#### Acceptance Criteria

1. THE Signature_Verifier SHALL use the Stellar SDK Keypair.fromPublicKey method to load the public key
2. THE Signature_Verifier SHALL use the Keypair.verify method to validate signatures
3. WHEN the Stellar SDK throws an exception during verification, THE Signature_Verifier SHALL catch it and return false
4. THE Signature_Verifier SHALL support Ed25519 signatures as used by Stellar wallets
5. THE Authentication_Server SHALL use the @stellar/stellar-sdk package for all cryptographic operations
6. THE Signature_Verifier SHALL not implement custom cryptographic algorithms

### Requirement 9: Testing and Verification

**User Story:** As a developer, I want to verify the authentication system works correctly, so that I can deploy with confidence.

#### Acceptance Criteria

1. WHEN a valid Signature is provided, THE Authentication_Server SHALL successfully create a session
2. WHEN an invalid Signature is provided, THE Authentication_Server SHALL reject the request with status 401
3. WHEN a Nonce is reused, THE Authentication_Server SHALL reject the second attempt with status 401
4. WHEN the project is built with npm run build, THE build SHALL complete without errors
5. WHEN the project is linted with npm run lint, THE linting SHALL pass without errors
6. THE Authentication_Server SHALL not introduce regressions in wallet connection, message rendering, or navigation features
