/**
 * =============================================================================
 * F0 - GITHUB WEBHOOK HANDLER
 * =============================================================================
 * 
 * POST /api/webhook
 * 
 * Handles GitHub webhook events for content updates. When content is pushed
 * to the repository, this endpoint:
 * 1. Validates the webhook signature
 * 2. Invalidates the navigation cache
 * 3. Optionally triggers a git pull (if configured)
 * 
 * SETUP:
 * 1. In GitHub repo settings, add webhook:
 *    - URL: https://your-domain.com/api/webhook
 *    - Content type: application/json
 *    - Secret: (set GITHUB_WEBHOOK_SECRET env var)
 *    - Events: Push events
 * 
 * SECURITY:
 * - Validates X-Hub-Signature-256 header
 * - Only processes push events
 * - Logs all webhook attempts
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { invalidateNavigationCache } from '../utils/navigation'

// =============================================================================
// SIGNATURE VERIFICATION
// =============================================================================

/**
 * Verify GitHub webhook signature
 * Uses HMAC SHA-256 with timing-safe comparison
 */
function verifySignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false
  }
  
  // GitHub sends signature as "sha256=<hash>"
  const parts = signature.split('=')
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return false
  }
  
  const expectedSignature = parts[1]
  const computedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  
  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(computedSignature)
    )
  } catch {
    return false
  }
}

// =============================================================================
// HANDLER
// =============================================================================

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  
  // Get webhook secret from config
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET
  
  // Get GitHub headers
  const signature = getHeader(event, 'x-hub-signature-256')
  const githubEvent = getHeader(event, 'x-github-event')
  const deliveryId = getHeader(event, 'x-github-delivery')
  
  console.log(`[Webhook] Received: event=${githubEvent}, delivery=${deliveryId}`)
  
  // Get raw body for signature verification
  const rawBody = await readRawBody(event)
  
  // Verify signature if secret is configured
  if (webhookSecret) {
    if (!verifySignature(rawBody || '', signature, webhookSecret)) {
      console.warn(`[Webhook] Invalid signature for delivery ${deliveryId}`)
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
        data: { message: 'Invalid webhook signature' },
      })
    }
  } else {
    console.warn('[Webhook] No webhook secret configured - skipping signature verification')
  }
  
  // Parse body
  const body = JSON.parse(rawBody || '{}')
  
  // Handle different event types
  switch (githubEvent) {
    case 'push':
      // Push event - content may have changed
      console.log(`[Webhook] Push to ${body.ref} by ${body.pusher?.name}`)
      
      // Only process pushes to main/master branch
      const branch = body.ref?.replace('refs/heads/', '')
      if (branch === 'main' || branch === 'master') {
        // Invalidate caches
        invalidateNavigationCache()
        
        console.log('[Webhook] Caches invalidated')
        
        // Note: In a full implementation, you might:
        // 1. Run `git pull` to update content
        // 2. Trigger a rebuild if using static generation
        // 3. Notify connected clients via WebSocket
        
        return {
          success: true,
          message: 'Content cache invalidated',
          branch,
          commit: body.head_commit?.id,
        }
      }
      
      return {
        success: true,
        message: 'Ignored - not main branch',
        branch,
      }
    
    case 'ping':
      // GitHub sends ping when webhook is first set up
      console.log(`[Webhook] Ping received - webhook configured correctly`)
      return {
        success: true,
        message: 'Pong! Webhook configured successfully.',
      }
    
    default:
      // Ignore other events
      console.log(`[Webhook] Ignoring event type: ${githubEvent}`)
      return {
        success: true,
        message: `Event type '${githubEvent}' ignored`,
      }
  }
})
