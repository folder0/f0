/**
 * =============================================================================
 * F0 - AUTHENTICATION MIDDLEWARE
 * =============================================================================
 *
 * This middleware enforces authentication based on AUTH_MODE configuration.
 *
 * AUTH MODES:
 * - 'public':  No authentication required (all routes accessible)
 * - 'private': All routes require valid JWT except:
 *   - /login
 *   - /api/auth/*
 *   - /_health, /_ready
 *   - /api/webhook (authenticated by its own HMAC signature, not a JWT)
 *
 *   NOTE: In private mode the documentation itself is private, so the AI/SEO
 *   endpoints (/llms.txt, /sitemap.xml, /feed.xml) are intentionally NOT exempt
 *   — exposing them would leak the full content of a private site.
 *
 * CONSTRAINT COMPLIANCE:
 * - C-SEC-PRIVATE-NOT-PUBLIC-005: /private never accessible via HTTP
 *
 * HOW IT WORKS:
 * 1. Check AUTH_MODE - if 'public', allow all
 * 2. Check if route is exempt (login, auth API)
 * 3. Extract JWT from Authorization header or cookie
 * 4. Verify token and attach user info to event context
 * 5. Return 401 if unauthorized
 *
 * SECURITY:
 * - All token validation failures are logged with IP/timestamp
 */

import { verifyToken, type JwtPayload } from '../utils/jwt'
import { auditLog, getClientIp } from '../utils/audit'
import { checkEmailAccess } from '../utils/allowlist'
import { isSessionRevoked } from '../utils/sessions'
import { markPrivateResponse } from '../utils/http-cache'
import { logger } from '../utils/logger'
import { f0Config } from '../utils/f0-config'

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Routes that are always accessible, even in private mode
 */
const PUBLIC_ROUTES = [
  '/login',
  '/api/auth/request-otp',
  '/api/auth/verify-otp',
  '/api/auth/logout',       // must always run so it can clear the cookie
  '/_health',
  '/_ready',
  // GitHub webhook authenticates itself via HMAC signature (see webhook.post.ts).
  // GitHub cannot present a JWT, so it must bypass the JWT gate. Fails closed
  // when GITHUB_WEBHOOK_SECRET is unset.
  '/api/webhook',
]

/**
 * Route prefixes that are always blocked
 * These should NEVER be accessible via HTTP
 */
const BLOCKED_ROUTES = [
  '/private',
  '/..',        // Path traversal attempt
  '/server',    // Server internals
]

// =============================================================================
// MIDDLEWARE
// =============================================================================

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const path = url.pathname // Use pathname to exclude query string
  const settings = f0Config()
  
  // ---------------------------------------------------------------------------
  // SECURITY: Block access to sensitive paths
  // ---------------------------------------------------------------------------
  for (const blocked of BLOCKED_ROUTES) {
    if (path.startsWith(blocked) || path.includes('/../')) {
      logger.warn('Blocked access attempt', { path, ip: getClientIp(event) })
      throw createError({
        statusCode: 403,
        statusMessage: 'Forbidden',
      })
    }
  }
  
  // ---------------------------------------------------------------------------
  // FAIL CLOSED: a private site with unusable settings serves nothing
  // ---------------------------------------------------------------------------
  // The startup check exits in this case; this covers requests that arrive
  // before it does. Liveness stays up so the log can be read.
  if (settings.problems.length > 0 && path !== '/_health') {
    markPrivateResponse(event)
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: { message: 'Site configuration is incomplete' },
    })
  }

  // ---------------------------------------------------------------------------
  // PUBLIC MODE: Allow all access
  // ---------------------------------------------------------------------------
  if (settings.authMode === 'public') {
    return // Continue to route handler
  }
  
  // ---------------------------------------------------------------------------
  // PRIVATE MODE: Check authentication
  // ---------------------------------------------------------------------------

  // Nothing in private mode may be stored by a shared cache, including the
  // login redirects and 401s below, which never reach the response hook.
  // /_nuxt/* are fingerprinted build assets with no site content.
  if (!path.startsWith('/_nuxt/')) {
    markPrivateResponse(event)
  }
  
  // Check if route is exempt from auth
  const isPublicRoute = PUBLIC_ROUTES.some(route => 
    path === route || path.startsWith(route + '/')
  )
  
  // Allow public routes
  if (isPublicRoute) {
    return
  }
  
  // Allow only the app's own fingerprinted build assets (needed to render
  // /login) and the favicon. Do NOT exempt by file extension: content images
  // under /api/content/assets/** are private content in private mode.
  if (path.startsWith('/_nuxt/') || path === '/favicon.ico') {
    return
  }
  
  // ---------------------------------------------------------------------------
  // EXTRACT AND VERIFY TOKEN
  // ---------------------------------------------------------------------------

  // Build the login URL for page redirects, preserving where the user was going.
  const loginUrl = (reason?: string): string => {
    const params = new URLSearchParams()
    if (path !== '/') params.set('redirect', path)
    if (reason) params.set('reason', reason)
    const query = params.toString()
    return query ? `/login?${query}` : '/login'
  }

  // Reject the request: 401 for API routes, redirect to /login for pages.
  const deny = (apiMessage: string, reason?: string, error?: string) => {
    if (path.startsWith('/api/')) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: error ? { message: apiMessage, error } : { message: apiMessage },
      })
    }
    return sendRedirect(event, loginUrl(reason))
  }

  let token: string | null = null

  // Try Authorization header first (Bearer token)
  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  }

  // Fall back to cookie
  if (!token) {
    token = getCookie(event, 'f0_token') || null
  }

  // No token found
  if (!token) {
    if (path.startsWith('/api/')) {
      await auditLog(event, 'access_denied', 'anonymous', false, 'no_token', {
        path,
        method: event.method,
      })
    }
    return deny('Authentication required')
  }

  // Verify signature and expiry
  const result = verifyToken(token)

  if (!result.valid || !result.payload?.email) {
    deleteCookie(event, 'f0_token', { path: '/' })
    await auditLog(
      event,
      result.error === 'expired' ? 'token_expired' : 'token_invalid',
      result.payload?.email || 'unknown',
      false,
      result.error || 'missing_email',
      { path, method: event.method }
    )
    return deny(
      result.error === 'expired' ? 'Session expired, please log in again' : 'Invalid authentication token',
      'expired',
      result.error,
    )
  }

  // A signed token is not enough: logged-out sessions and users removed from
  // the allowlist lose access immediately, not when the 72h token expires.
  const { email, jti } = result.payload
  const revoked = await isSessionRevoked(jti)
  const access = revoked ? 'denied' : await checkEmailAccess(email, settings.privateDir)

  // Allowlist unreadable and never loaded: fail closed, but keep the cookie so
  // sessions resume once the file is fixed.
  if (access === 'unavailable') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: { message: 'Access control is temporarily unavailable' },
    })
  }

  if (revoked || access !== 'allowed') {
    deleteCookie(event, 'f0_token', { path: '/' })
    await auditLog(event, 'token_invalid', email, false, revoked ? 'revoked' : 'not_allowlisted', {
      path,
      method: event.method,
    })
    return deny('Session is no longer valid, please log in again', 'expired', revoked ? 'revoked' : 'not_allowlisted')
  }

  // ---------------------------------------------------------------------------
  // ATTACH USER TO CONTEXT
  // ---------------------------------------------------------------------------

  // Store user info in event context for use in route handlers
  event.context.auth = {
    authenticated: true,
    email,
  }
})

// =============================================================================
// TYPE AUGMENTATION
// =============================================================================

declare module 'h3' {
  interface H3EventContext {
    auth?: {
      authenticated: boolean
      email?: string
    }
  }
}
