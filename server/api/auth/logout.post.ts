/**
 * =============================================================================
 * F0 - LOGOUT API ENDPOINT
 * =============================================================================
 *
 * POST /api/auth/logout
 *
 * Ends the current session:
 * 1. Revokes the session token (by its jti) until it would have expired,
 *    so a copied token stops working immediately.
 * 2. Clears the httpOnly f0_token cookie.
 *
 * Always succeeds from the caller's point of view, even with a missing,
 * expired or invalid token, so a logout can never get stuck. Exempt from the
 * auth middleware so it still runs when the session is already invalid.
 */

import { verifyToken } from '../../utils/jwt'
import { revokeSession } from '../../utils/sessions'
import { auditLog } from '../../utils/audit'
import { logger } from '../../utils/logger'

export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : getCookie(event, 'f0_token') || null

  let email = 'anonymous'
  let revoked = false

  if (token) {
    try {
      const result = verifyToken(token)
      if (result.valid && result.payload) {
        email = result.payload.email
        revoked = await revokeSession(result.payload)
      }
    }
    catch (error) {
      // e.g. no JWT secret configured on a public site: nothing to revoke
      logger.debug('Logout without a verifiable session', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  deleteCookie(event, 'f0_token', { path: '/' })
  await auditLog(event, 'logout', email, true, undefined, { revoked })

  return { success: true }
})
