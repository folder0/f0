/**
 * =============================================================================
 * F0 - CURRENT SESSION
 * =============================================================================
 *
 * GET /api/auth/session
 *
 * Tells the browser whether its httpOnly session cookie is valid, so page
 * scripts never need to hold the token itself. Always answers 200.
 *
 * RESPONSE:
 * { "authMode": "private", "authenticated": true, "user": { "email": "..." } }
 * { "authMode": "private", "authenticated": false }
 */

import { verifyToken } from '../../utils/jwt'
import { isSessionRevoked } from '../../utils/sessions'
import { checkEmailAccess } from '../../utils/allowlist'
import { f0Config } from '../../utils/f0-config'
import { logger } from '../../utils/logger'

export default defineEventHandler(async (event) => {
  const settings = f0Config()
  const anonymous = { authMode: settings.authMode, authenticated: false as const }

  const authHeader = getHeader(event, 'authorization')
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : getCookie(event, 'f0_token') || null
  if (!token) return anonymous

  try {
    const result = verifyToken(token)
    if (!result.valid || !result.payload?.email) return anonymous

    const { email, jti } = result.payload
    if (await isSessionRevoked(jti)) return anonymous
    if ((await checkEmailAccess(email, settings.privateDir)) !== 'allowed') return anonymous

    return { authMode: settings.authMode, authenticated: true as const, user: { email } }
  }
  catch (error) {
    // e.g. no JWT secret on a public site: there are no sessions to check
    logger.debug('Session check without a verifiable token', { error: error instanceof Error ? error.message : String(error) })
    return anonymous
  }
})
