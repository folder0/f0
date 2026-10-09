/**
 * =============================================================================
 * F0 - ADMIN AUTHORIZATION GUARD
 * =============================================================================
 *
 * Shared authorization gate for the /api/admin/* surface (file upload, audit
 * logs, etc.). These endpoints expose write access to the content directory
 * and read access to PII (emails + IPs in the audit log), so they must never
 * be reachable without an authenticated admin.
 *
 * DESIGN:
 * - The admin surface REQUIRES authentication to be enabled. In public mode
 *   (AUTH_MODE=public, the default) there is no login at all, so admin
 *   endpoints are rejected outright with 403 rather than silently exposed.
 * - In private mode the global auth middleware has already verified the JWT and
 *   attached event.context.auth. We re-check it here (defence in depth) and
 *   additionally require the user to be an admin per the allowlist.
 *
 * CONSTRAINT COMPLIANCE:
 * - C-SEC-OTP-ALLOWLIST-ONLY-006: admin identity derives from the allowlist
 * - C-SEC-PRIVATE-NOT-PUBLIC-005: admin surface is unavailable without auth
 */

import type { H3Event } from 'h3'
import { isEmailAdmin } from './allowlist'
import { auditLog } from './audit'
import { f0Config } from './f0-config'

/**
 * Throw an appropriate HTTP error unless the request comes from an
 * authenticated admin. Returns the admin's email on success.
 */
export async function assertAdmin(event: H3Event): Promise<string> {
  const settings = f0Config()

  // Admin endpoints are only meaningful when authentication is enabled.
  if (settings.authMode !== 'private') {
    await auditLog(event, 'access_denied', 'anonymous', false, 'admin_requires_private_mode', {
      path: getRequestURL(event).pathname,
      method: event.method,
    })
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: { message: 'Admin endpoints require AUTH_MODE=private' },
    })
  }

  // The global auth middleware should have populated this in private mode.
  const auth = event.context.auth
  const email = auth?.email

  if (!auth?.authenticated || !email) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: { message: 'Authentication required' },
    })
  }

  // Must be an admin per the allowlist.
  const allowed = await isEmailAdmin(email, settings.privateDir)
  if (!allowed) {
    await auditLog(event, 'access_denied', email, false, 'not_admin', {
      path: getRequestURL(event).pathname,
      method: event.method,
    })
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
      data: { message: 'Admin access required' },
    })
  }

  return email
}
