/**
 * =============================================================================
 * F0 - REQUEST OTP API ENDPOINT
 * =============================================================================
 * 
 * POST /api/auth/request-otp
 * 
 * Initiates the OTP authentication flow:
 * 1. Validates email format
 * 2. Checks if email is in allowlist
 * 3. Generates OTP (with rate limiting)
 * 4. Sends OTP via email
 * 
 * REQUEST BODY:
 * {
 *   "email": "user@example.com"
 * }
 * 
 * RESPONSES:
 * - 200: OTP sent successfully
 * - 400: Invalid email format
 * - 403: Email not in allowlist
 * - 429: Rate limited
 * - 500: Server error (email sending failed)
 * 
 * SECURITY:
 * - Always returns 200 for valid email format to prevent enumeration
 * - Rate limited to prevent abuse
 * - All attempts are logged with IP/timestamp
 */

import { isEmailAllowed } from '../../utils/allowlist'
import { generateOtp, getOtpCode } from '../../utils/otp'
import { sendOtpEmail } from '../../utils/email'
import { auditLog } from '../../utils/audit'
import { f0Config } from '../../utils/f0-config'

// =============================================================================
// REQUEST VALIDATION
// =============================================================================

interface RequestOtpBody {
  email?: string
}

/**
 * Basic email format validation
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
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
  const body = await readBody<RequestOtpBody>(event)
  const email = body?.email?.toLowerCase().trim() || ''
  
  // Validate email format
  if (!email || !isValidEmail(email)) {
    await auditLog(event, 'otp_requested', email || 'invalid', false, 'invalid_email_format')
    
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Valid email address is required' },
    })
  }
  
  // Check allowlist
  const allowed = await isEmailAllowed(email, settings.privateDir)
  
  if (!allowed) {
    // Log the rejection
    await auditLog(event, 'allowlist_rejected', email, false, 'email_not_in_allowlist')
    
    // SECURITY: Return generic message to prevent email enumeration
    // The user just won't receive an email
    return {
      success: true,
      message: 'If your email is registered, you will receive a verification code.',
    }
  }
  
  // Generate OTP
  const otpResult = await generateOtp(email)
  
  if (!otpResult.success) {
    if (otpResult.error === 'rate_limited') {
      await auditLog(event, 'otp_rate_limited', email, false, 'too_many_requests', {
        retryAfter: otpResult.retryAfter,
      })
      
      throw createError({
        statusCode: 429,
        statusMessage: 'Too Many Requests',
        data: { 
          message: 'Too many requests. Please wait before trying again.',
          retryAfter: otpResult.retryAfter,
        },
      })
    }
    
    await auditLog(event, 'otp_requested', email, false, 'generation_failed')
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to generate verification code' },
    })
  }
  
  // Get the OTP code and send email
  const otpCode = await getOtpCode(email)
  
  if (!otpCode) {
    await auditLog(event, 'otp_requested', email, false, 'code_retrieval_failed')
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to retrieve verification code' },
    })
  }
  
  try {
    await sendOtpEmail(email, otpCode)
    
    await auditLog(event, 'otp_sent', email, true)
    
    return {
      success: true,
      message: 'Verification code sent to your email.',
    }
  } catch (error) {
    await auditLog(event, 'otp_send_failed', email, false, 'email_delivery_failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to send verification email. Please try again.' },
    })
  }
})
