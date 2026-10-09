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
import { logger } from '../utils/logger'

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
  const config = useRuntimeConfig()
  
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
  // PUBLIC MODE: Allow all access
  // ---------------------------------------------------------------------------
  if (config.authMode === 'public') {
    return // Continue to route handler
  }
  
  // ---------------------------------------------------------------------------
  // PRIVATE MODE: Check authentication
  // ---------------------------------------------------------------------------
  
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
    // For API routes, return 401
    if (path.startsWith('/api/')) {
      await auditLog(event, 'access_denied', 'anonymous', false, 'no_token', {
        path,
        method: event.method,
      })
      
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: { message: 'Authentication required' },
      })
    }
    
    // For page routes, redirect to login (avoid redirect loop)
    const redirectTo = path === '/' ? '' : `?redirect=${encodeURIComponent(path)}`
    return sendRedirect(event, `/login${redirectTo}`)
  }
  
  // Verify token
  const result = verifyToken(token)
  
  if (!result.valid) {
    // Clear invalid cookie
    deleteCookie(event, 'f0_token')
    
    const email = result.payload?.email || 'unknown'
    
    // Log the token failure
    await auditLog(
      event, 
      result.error === 'expired' ? 'token_expired' : 'token_invalid',
      email,
      false,
      result.error,
      { path, method: event.method }
    )
    
    // For API routes, return appropriate error
    if (path.startsWith('/api/')) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: { 
          message: result.error === 'expired' 
            ? 'Session expired, please log in again' 
            : 'Invalid authentication token',
          error: result.error,
        },
      })
    }
    
    // For page routes, redirect to login
    const redirectTo = path === '/' ? '' : `?redirect=${encodeURIComponent(path)}`
    return sendRedirect(event, `/login${redirectTo}&reason=expired`)
  }
  
  // ---------------------------------------------------------------------------
  // ATTACH USER TO CONTEXT
  // ---------------------------------------------------------------------------
  
  // Store user info in event context for use in route handlers
  event.context.auth = {
    authenticated: true,
    email: result.payload?.email,
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
