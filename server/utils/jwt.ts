/**
 * =============================================================================
 * F0 - JWT (JSON WEB TOKEN) UTILITY
 * =============================================================================
 * 
 * This module handles JWT creation and verification for session management.
 * 
 * JWT STRATEGY:
 * - Stateless authentication (no session store needed)
 * - Token stored in localStorage on client
 * - 72-hour expiry as per PRD
 * - HS256 signing algorithm (symmetric)
 * 
 * TOKEN PAYLOAD:
 * {
 *   email: "user@example.com",
 *   iat: 1234567890,        // Issued at
 *   exp: 1234567890 + 72h   // Expiry
 * }
 * 
 * SECURITY NOTES:
 * - JWT_SECRET must be strong and kept secure
 * - Tokens are not revocable (by design for simplicity)
 * - For revocation needs, consider adding token ID to blacklist (future)
 */

import jwt from 'jsonwebtoken'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * JWT payload structure
 */
export interface JwtPayload {
  email: string
  iat?: number  // Issued at (added by jwt.sign)
  exp?: number  // Expiry (added by jwt.sign)
}

/**
 * Result of token verification
 */
export interface JwtVerifyResult {
  valid: boolean
  payload?: JwtPayload
  error?: 'expired' | 'invalid' | 'malformed'
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Token expiry time: 72 hours (as per PRD)
 */
const TOKEN_EXPIRY = '72h'

/**
 * Get JWT secret from runtime config
 * Throws if not configured (catches misconfiguration early)
 */
function getJwtSecret(): string {
  const config = useRuntimeConfig()
  const secret = config.jwtSecret
  
  if (!secret || secret === 'change-me-in-production') {
    // In production, this should fail
    // In development, we allow the default but warn
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET not configured for production')
    }
    console.warn('[JWT] Using default secret - NOT SAFE FOR PRODUCTION')
  }
  
  return secret
}

// =============================================================================
// TOKEN OPERATIONS
// =============================================================================

/**
 * Create a JWT for an authenticated user
 * 
 * @param email - User's email address
 * @returns Signed JWT string
 */
export function createToken(email: string): string {
  const payload: JwtPayload = {
    email: email.toLowerCase().trim(),
  }
  
  const secret = getJwtSecret()
  
  const token = jwt.sign(payload, secret, {
    expiresIn: TOKEN_EXPIRY,
    algorithm: 'HS256',
  })
  
  console.log(`[JWT] Token created for ${email}`)
  
  return token
}

/**
 * Verify a JWT and extract payload
 * 
 * @param token - JWT string to verify
 * @returns Verification result with payload if valid
 */
export function verifyToken(token: string): JwtVerifyResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'malformed' }
  }
  
  const secret = getJwtSecret()
  
  try {
    const payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
    }) as JwtPayload
    
    return { valid: true, payload }
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      console.log('[JWT] Token expired')
      return { valid: false, error: 'expired' }
    }
    
    if (error instanceof jwt.JsonWebTokenError) {
      console.log('[JWT] Invalid token:', error.message)
      return { valid: false, error: 'invalid' }
    }
    
    console.error('[JWT] Verification error:', error)
    return { valid: false, error: 'invalid' }
  }
}

/**
 * Extract email from a valid token
 * Convenience function for common use case
 * 
 * @param token - JWT string
 * @returns Email if valid, null otherwise
 */
export function getEmailFromToken(token: string): string | null {
  const result = verifyToken(token)
  return result.valid ? result.payload?.email || null : null
}

/**
 * Decode token without verification
 * Useful for displaying user info before full verification
 * DO NOT USE FOR AUTHENTICATION
 * 
 * @param token - JWT string
 * @returns Decoded payload or null
 */
export function decodeToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.decode(token) as JwtPayload | null
    return decoded
  } catch {
    return null
  }
}

/**
 * Check if a token is close to expiry
 * Useful for token refresh prompts
 * 
 * @param token - JWT string
 * @param thresholdMinutes - Minutes before expiry to consider "close"
 * @returns true if token expires within threshold
 */
export function isTokenExpiringSoon(token: string, thresholdMinutes: number = 60): boolean {
  const decoded = decodeToken(token)
  
  if (!decoded || !decoded.exp) {
    return true // Treat invalid tokens as expiring
  }
  
  const expiryTime = decoded.exp * 1000 // Convert to milliseconds
  const thresholdTime = Date.now() + (thresholdMinutes * 60 * 1000)
  
  return expiryTime < thresholdTime
}

/**
 * Get remaining time until token expiry
 * 
 * @param token - JWT string
 * @returns Remaining time in seconds, or 0 if expired/invalid
 */
export function getTokenRemainingTime(token: string): number {
  const decoded = decodeToken(token)
  
  if (!decoded || !decoded.exp) {
    return 0
  }
  
  const remaining = decoded.exp - Math.floor(Date.now() / 1000)
  return Math.max(0, remaining)
}
