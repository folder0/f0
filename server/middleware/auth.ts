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
 *   - /llms.txt (configurable)
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
 */

import { verifyToken, type JwtPayload } from '../utils/jwt'

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
  const path = event.path
  const config = useRuntimeConfig()
  
  // ---------------------------------------------------------------------------
  // SECURITY: Block access to sensitive paths
  // ---------------------------------------------------------------------------
  for (const blocked of BLOCKED_ROUTES) {
    if (path.startsWith(blocked) || path.includes('/../')) {
      console.warn(`[Auth] Blocked access attempt: ${path}`)
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
  
  // Allow static assets
  if (path.startsWith('/_nuxt/') || path.startsWith('/assets/')) {
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
    token = getCookie(event, 'litedocs_token') || null
  }
  
  // No token found
  if (!token) {
    // For API routes, return 401
    if (path.startsWith('/api/')) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: { message: 'Authentication required' },
      })
    }
    
    // For page routes, redirect to login
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}`)
  }
  
  // Verify token
  const result = verifyToken(token)
  
  if (!result.valid) {
    // Clear invalid cookie
    deleteCookie(event, 'litedocs_token')
    
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
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(path)}&reason=expired`)
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
