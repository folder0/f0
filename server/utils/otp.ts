/**
 * =============================================================================
 * F0 - OTP (ONE-TIME PASSWORD) MANAGER
 * =============================================================================
 * 
 * This module handles OTP generation, storage, verification, and rate limiting.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-SEC-OTP-RATE-LIMIT-007: Max 3 verification attempts per 5 minutes
 * 
 * OTP FLOW:
 * 1. User requests OTP → generateOtp(email)
 * 2. System sends OTP via email
 * 3. User submits OTP → verifyOtp(email, code)
 * 4. On success → clear OTP, issue JWT
 * 5. On failure → increment attempt counter
 * 
 * SECURITY FEATURES:
 * - 8-digit cryptographically secure codes (10^8 = 100 million combinations)
 * - OTPs expire after 5 minutes
 * - Max 3 verification attempts per OTP
 * - Rate limiting on OTP requests (prevent abuse)
 * - Timing-safe comparison to prevent timing attacks
 */

import { randomInt, timingSafeEqual } from 'crypto'
import { storage, otpKey, rateLimitKey, OTP_CONFIG } from './storage'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Stored OTP data
 */
interface StoredOtp {
  code: string
  email: string
  createdAt: number
  attempts: number
}

/**
 * Result of OTP verification
 */
export interface OtpVerifyResult {
  success: boolean
  error?: 'invalid_code' | 'expired' | 'max_attempts' | 'not_found' | 'rate_limited'
  attemptsRemaining?: number
}

/**
 * Result of OTP generation
 */
export interface OtpGenerateResult {
  success: boolean
  error?: 'rate_limited' | 'internal_error'
  retryAfter?: number  // Seconds until next request allowed
}

// =============================================================================
// OTP GENERATION
// =============================================================================

/**
 * Generate a cryptographically secure 8-digit OTP
 * Uses crypto.randomInt which is cryptographically secure
 * 
 * @returns 8-digit string (zero-padded)
 */
function generateSecureOtp(): string {
  // Generate a random number between 0 and 99,999,999
  // randomInt is cryptographically secure
  const code = randomInt(0, 100_000_000)
  
  // Zero-pad to ensure always 8 digits
  return code.toString().padStart(OTP_CONFIG.CODE_LENGTH, '0')
}

/**
 * Check if OTP requests are rate limited for an email
 * Prevents abuse by limiting how many OTPs can be requested
 * 
 * @param email - Email address to check
 * @returns Object with limited status and retry time
 */
async function checkRequestRateLimit(email: string): Promise<{
  limited: boolean
  retryAfter?: number
}> {
  const key = rateLimitKey(email, 'request')
  const count = await storage.get<number>(key)
  
  if (count !== null && count >= OTP_CONFIG.MAX_OTP_REQUESTS) {
    // Calculate remaining time in the rate limit window
    // Since we don't store exact expiry, estimate based on window
    return { 
      limited: true, 
      retryAfter: OTP_CONFIG.RATE_LIMIT_WINDOW_SECONDS 
    }
  }
  
  return { limited: false }
}

/**
 * Generate and store a new OTP for an email
 * 
 * @param email - Email address to generate OTP for
 * @returns Result indicating success or rate limit error
 */
export async function generateOtp(email: string): Promise<OtpGenerateResult> {
  const normalizedEmail = email.toLowerCase().trim()
  
  // Check rate limit
  const rateLimit = await checkRequestRateLimit(normalizedEmail)
  if (rateLimit.limited) {
    console.log(`[OTP] Rate limited for ${normalizedEmail}`)
    return {
      success: false,
      error: 'rate_limited',
      retryAfter: rateLimit.retryAfter,
    }
  }
  
  try {
    // Generate new OTP
    const code = generateSecureOtp()
    
    // Store OTP with TTL
    const otpData: StoredOtp = {
      code,
      email: normalizedEmail,
      createdAt: Date.now(),
      attempts: 0,
    }
    
    await storage.set(
      otpKey(normalizedEmail),
      otpData,
      OTP_CONFIG.TTL_SECONDS
    )
    
    // Increment request rate limit counter
    await storage.increment(
      rateLimitKey(normalizedEmail, 'request'),
      OTP_CONFIG.RATE_LIMIT_WINDOW_SECONDS
    )
    
    console.log(`[OTP] Generated for ${normalizedEmail}: ${code}`)
    
    return { success: true }
  } catch (error) {
    console.error('[OTP] Error generating OTP:', error)
    return { success: false, error: 'internal_error' }
  }
}

/**
 * Get the current OTP for an email (used by email sender)
 * 
 * @param email - Email address
 * @returns OTP code or null if not found
 */
export async function getOtpCode(email: string): Promise<string | null> {
  const normalizedEmail = email.toLowerCase().trim()
  const otpData = await storage.get<StoredOtp>(otpKey(normalizedEmail))
  return otpData?.code || null
}

// =============================================================================
// OTP VERIFICATION
// =============================================================================

/**
 * Perform timing-safe string comparison
 * Prevents timing attacks by ensuring comparison takes constant time
 * 
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

/**
 * Verify an OTP code for an email
 * 
 * @param email - Email address
 * @param code - OTP code to verify
 * @returns Verification result
 */
export async function verifyOtp(email: string, code: string): Promise<OtpVerifyResult> {
  const normalizedEmail = email.toLowerCase().trim()
  const normalizedCode = code.trim()
  
  // Validate input
  if (!normalizedCode || normalizedCode.length !== OTP_CONFIG.CODE_LENGTH) {
    return { success: false, error: 'invalid_code' }
  }
  
  // Get stored OTP
  const key = otpKey(normalizedEmail)
  const otpData = await storage.get<StoredOtp>(key)
  
  if (!otpData) {
    console.log(`[OTP] No OTP found for ${normalizedEmail}`)
    return { success: false, error: 'not_found' }
  }
  
  // Check if max attempts exceeded
  if (otpData.attempts >= OTP_CONFIG.MAX_VERIFY_ATTEMPTS) {
    console.log(`[OTP] Max attempts exceeded for ${normalizedEmail}`)
    // Delete the OTP to force requesting a new one
    await storage.delete(key)
    return { success: false, error: 'max_attempts', attemptsRemaining: 0 }
  }
  
  // Check if expired (belt and suspenders - storage TTL should handle this)
  const age = Date.now() - otpData.createdAt
  if (age > OTP_CONFIG.TTL_SECONDS * 1000) {
    console.log(`[OTP] Expired for ${normalizedEmail}`)
    await storage.delete(key)
    return { success: false, error: 'expired' }
  }
  
  // Verify code using timing-safe comparison
  const isValid = safeCompare(normalizedCode, otpData.code)
  
  if (isValid) {
    console.log(`[OTP] Verified successfully for ${normalizedEmail}`)
    // Delete OTP after successful verification (one-time use)
    await storage.delete(key)
    return { success: true }
  }
  
  // Invalid code - increment attempt counter
  otpData.attempts += 1
  const attemptsRemaining = OTP_CONFIG.MAX_VERIFY_ATTEMPTS - otpData.attempts
  
  console.log(`[OTP] Invalid code for ${normalizedEmail}, attempts: ${otpData.attempts}/${OTP_CONFIG.MAX_VERIFY_ATTEMPTS}`)
  
  // Update stored OTP with new attempt count
  // Preserve remaining TTL (approximately)
  const remainingTtl = Math.max(
    1,
    OTP_CONFIG.TTL_SECONDS - Math.floor(age / 1000)
  )
  await storage.set(key, otpData, remainingTtl)
  
  // If max attempts reached after this failure, delete OTP
  if (attemptsRemaining <= 0) {
    await storage.delete(key)
  }
  
  return { 
    success: false, 
    error: 'invalid_code',
    attemptsRemaining: Math.max(0, attemptsRemaining),
  }
}

/**
 * Clear OTP for an email (admin use or cleanup)
 */
export async function clearOtp(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()
  await storage.delete(otpKey(normalizedEmail))
  console.log(`[OTP] Cleared for ${normalizedEmail}`)
}

/**
 * Check if a verification rate limit applies
 * This is separate from the OTP attempt limit - it's for rapid-fire requests
 */
export async function checkVerifyRateLimit(email: string): Promise<boolean> {
  const key = rateLimitKey(email, 'verify')
  const count = await storage.increment(key, 60) // 1 minute window for verify attempts
  
  // Allow 10 verification requests per minute (covers retries)
  return count > 10
}
