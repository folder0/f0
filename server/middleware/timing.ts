/**
 * =============================================================================
 * F0 - REQUEST TIMING MIDDLEWARE
 * =============================================================================
 * 
 * Nitro middleware that measures and logs request duration for all routes.
 * 
 * Features:
 * - Server-Timing header on every response (visible in browser devtools)
 * - Structured log warning for slow requests (>500ms)
 * - Debug-level logging for all API requests with duration
 * 
 * The Server-Timing header (e.g., `Server-Timing: total;dur=42`) lets
 * frontend devtools and monitoring tools see server response time without
 * requiring log access.
 */

import { logger } from '../utils/logger'

export default defineEventHandler(async (event) => {
  const start = performance.now()

  event.node.res.on('finish', () => {
    const duration = Math.round(performance.now() - start)
    const path = getRequestURL(event).pathname
    const status = event.node.res.statusCode

    // Add Server-Timing header
    // Must be set before finish, but we're in the finish handler —
    // the header was already set via the appendHeader below.

    // Log slow requests
    if (duration > 500) {
      logger.warn('Slow request', { path, duration, status })
    } else if (path.startsWith('/api/') && duration > 0) {
      logger.debug('Request completed', { path, duration, status })
    }
  })

  // Set Server-Timing header (before the response is sent)
  event.node.res.on('close', () => {})

  // Use a response hook to set the timing header
  const onBeforeResponse = () => {
    const duration = Math.round(performance.now() - start)
    try {
      if (!event.node.res.headersSent) {
        setHeader(event, 'Server-Timing', `total;dur=${duration}`)
      }
    } catch {
      // Headers already sent
    }
  }

  // Hook into response lifecycle
  event.node.res.on('pipe', onBeforeResponse)

  // Also try to set it via Nitro's built-in hook
  // This runs before the response body is sent
  const originalEnd = event.node.res.end
  const originalWrite = event.node.res.write

  // Intercept the first write to inject Server-Timing
  let headerSet = false
  const setTimingHeader = () => {
    if (!headerSet && !event.node.res.headersSent) {
      const duration = Math.round(performance.now() - start)
      try {
        event.node.res.setHeader('Server-Timing', `total;dur=${duration}`)
      } catch {
        // Already sent
      }
      headerSet = true
    }
  }

  event.node.res.write = function (...args: Parameters<typeof originalWrite>) {
    setTimingHeader()
    return originalWrite.apply(this, args)
  } as typeof originalWrite

  event.node.res.end = function (...args: Parameters<typeof originalEnd>) {
    setTimingHeader()
    return originalEnd.apply(this, args)
  } as typeof originalEnd
})
