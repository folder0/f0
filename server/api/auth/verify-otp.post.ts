/**
 * =============================================================================
 * F0 - VERIFY OTP API ENDPOINT
 * =============================================================================
 * 
 * POST /api/auth/verify-otp
 * 
 * Completes the OTP authentication flow:
 * 1. Validates request format
 * 2. Verifies OTP code
 * 3. Issues JWT on success
 * 4. Sets authentication cookie
 * 
 * REQUEST BODY:
 * {
 *   "email": "user@example.com",
 *   "code": "12345678"
 * }
 * 
 * RESPONSES:
 * - 200: Authentication successful (includes JWT token)
 * - 400: Invalid request format
 * - 401: Invalid/expired code or max attempts exceeded
 * - 429: Rate limited
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-SEC-OTP-RATE-LIMIT-007: Max 3 verification attempts
 * 
 * SECURITY:
 * - All attempts are logged with IP/timestamp for audit
 */

import { verifyOtp, checkVerifyRateLimit } from '../../utils/otp'
import { createToken } from '../../utils/jwt'
import { OTP_CONFIG } from '../../utils/storage'
import { auditLog } from '../../utils/audit'
import { f0Config } from '../../utils/f0-config'

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

interface VerifyOtpBody {
  email?: string
  code?: string
}

// =============================================================================
// HANDLER
// =============================================================================

export default defineEventHandler(async (event) => {
  const settings = f0Config()
  
  // Check if auth is enabled
  if (settings.authMode === 'public') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Authentication is not enabled' },
    })
  }
  
  // Parse request body
  const body = await readBody<VerifyOtpBody>(event)
  const email = body?.email?.toLowerCase().trim() || ''
  const code = body?.code?.trim() || ''
  
  // Validate inputs
  if (!email) {
    await auditLog(event, 'otp_failed', 'unknown', false, 'missing_email')
    
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Email is required' },
    })
  }
  
  if (!code) {
    await auditLog(event, 'otp_failed', email, false, 'missing_code')
    
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Verification code is required' },
    })
  }
  
  if (code.length !== OTP_CONFIG.CODE_LENGTH) {
    await auditLog(event, 'otp_failed', email, false, 'invalid_code_length', {
      providedLength: code.length,
      expectedLength: OTP_CONFIG.CODE_LENGTH,
    })
    
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: `Verification code must be ${OTP_CONFIG.CODE_LENGTH} digits` },
    })
  }
  
  // Check rate limit (rapid-fire protection)
  const rateLimited = await checkVerifyRateLimit(email)
  if (rateLimited) {
    await auditLog(event, 'otp_rate_limited', email, false, 'verify_rate_limit')
    
    throw createError({
      statusCode: 429,
      statusMessage: 'Too Many Requests',
      data: { message: 'Too many verification attempts. Please wait a moment.' },
    })
  }
  
  // Verify OTP
  const result = await verifyOtp(email, code)
  
  if (!result.success) {
    let message: string
    let statusCode = 401
    let auditEventType: 'otp_failed' | 'otp_expired' | 'otp_max_attempts' = 'otp_failed'
    
    switch (result.error) {
      case 'expired':
        message = 'Verification code has expired. Please request a new one.'
        auditEventType = 'otp_expired'
        break
      case 'max_attempts':
        message = 'Maximum verification attempts exceeded. Please request a new code.'
        auditEventType = 'otp_max_attempts'
        break
      case 'not_found':
        message = 'No verification code found. Please request a new one.'
        break
      case 'invalid_code':
        message = result.attemptsRemaining !== undefined && result.attemptsRemaining > 0
          ? `Invalid code. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} remaining.`
          : 'Invalid verification code.'
        break
      default:
        message = 'Verification failed. Please try again.'
    }
    
    await auditLog(event, auditEventType, email, false, result.error, {
      attemptsRemaining: result.attemptsRemaining,
    })
    
    throw createError({
      statusCode,
      statusMessage: 'Unauthorized',
      data: { 
        message,
        error: result.error,
        attemptsRemaining: result.attemptsRemaining,
      },
    })
  }
  
  // Generate JWT
  const token = createToken(email)
  
  // Set cookie for browser-based auth
  // HttpOnly for security, Secure in production
  setCookie(event, 'f0_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 72, // 72 hours (matches JWT expiry)
    path: '/',
  })
  
  // Log successful authentication
  await auditLog(event, 'login_success', email, true, undefined, {
    tokenIssued: true,
  })
  
  return {
    success: true,
    message: 'Authentication successful',
    // For API clients (scripts, agents) that send it as a Bearer token.
    // Browsers keep using the httpOnly cookie and do not store this.
    token,
    user: {
      email,
    },
  }
})
