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
import { f0Config } from '../utils/f0-config'
import type { H3Event } from 'h3'
import { logger } from '../utils/logger'
import { storage } from '../utils/storage'
import { invalidateContentCaches } from '../utils/invalidation'

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
// BODY LIMIT AND DEDUPE
// =============================================================================

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024   // GitHub push payloads are far smaller
const DELIVERY_DEDUPE_SECONDS = 10 * 60

/**
 * Read the request body as UTF-8, failing with 413 once it exceeds maxBytes.
 *
 * Reads the Node request directly: cancelling h3's web stream mid-body raised
 * an uncaught exception for chunked uploads. On overflow the rest of the body
 * is discarded unbuffered and the connection closes after the 413.
 */
function readBodyCapped(event: H3Event, maxBytes: number): Promise<string> {
  const declared = Number(getHeader(event, 'content-length') || 0)
  if (declared > maxBytes) {
    setResponseHeader(event, 'Connection', 'close')
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  }

  const req = event.node.req
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > maxBytes) {
        cleanup()
        // Keep the stream flowing with no listener so the remainder is dropped.
        req.resume()
        setResponseHeader(event, 'Connection', 'close')
        reject(createError({ statusCode: 413, statusMessage: 'Payload Too Large' }))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onError = (error: Error) => {
      cleanup()
      reject(createError({ statusCode: 400, statusMessage: 'Bad Request', data: { message: error.message } }))
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

// =============================================================================
// HANDLER
// =============================================================================

export default defineEventHandler(async (event) => {
  // NUXT_GITHUB_WEBHOOK_SECRET or GITHUB_WEBHOOK_SECRET, read at startup
  const webhookSecret = f0Config().githubWebhookSecret
  
  // Get GitHub headers
  const signature = getHeader(event, 'x-hub-signature-256')
  const githubEvent = getHeader(event, 'x-github-event')
  const deliveryId = getHeader(event, 'x-github-delivery')
  
  logger.info('Webhook received', { event: githubEvent, delivery: deliveryId })
  
  // Fail closed: without a configured secret we cannot authenticate the caller,
  // so we must reject rather than process an unauthenticated request. This
  // endpoint invalidates every content cache, so leaving it open would let
  // anyone trigger cache-busting.
  if (!webhookSecret) {
    logger.error('Webhook rejected: GITHUB_WEBHOOK_SECRET is not configured')
    throw createError({
      statusCode: 503,
      statusMessage: 'Service Unavailable',
      data: { message: 'Webhook is not configured' },
    })
  }

  // Read the raw body (needed for the signature) with a size cap, so an
  // unauthenticated caller cannot make the server buffer an unbounded body.
  const rawBody = await readBodyCapped(event, MAX_WEBHOOK_BODY_BYTES)

  // Verify signature
  if (!verifySignature(rawBody || '', signature, webhookSecret)) {
    logger.warn('Invalid webhook signature', { delivery: deliveryId })
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: { message: 'Invalid webhook signature' },
    })
  }

  // GitHub retries deliveries; process each delivery id once. Only after the
  // signature check, so ids cannot be pre-registered without the secret.
  if (deliveryId) {
    const key = `webhook-delivery:${deliveryId}`
    if (await storage.exists(key)) {
      logger.info('Duplicate webhook delivery ignored', { delivery: deliveryId })
      return { success: true, message: 'Duplicate delivery ignored' }
    }
    await storage.set(key, true, DELIVERY_DEDUPE_SECONDS)
  }

  // Parse body — reject malformed JSON with a 400 rather than an uncaught 500.
  let body: Record<string, unknown> & {
    ref?: string
    pusher?: { name?: string }
    head_commit?: { id?: string }
  }
  try {
    body = JSON.parse(rawBody || '{}')
  } catch {
    logger.warn('Webhook rejected: malformed JSON body', { delivery: deliveryId })
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Invalid JSON payload' },
    })
  }
  
  // Handle different event types
  switch (githubEvent) {
    case 'push':
      // Push event - content may have changed
      logger.info('Webhook push event', { ref: body.ref, pusher: body.pusher?.name })
      
      // Only process pushes to main/master branch
      const branch = body.ref?.replace('refs/heads/', '')
      if (branch === 'main' || branch === 'master') {
        // Invalidate every content-derived cache (navigation, pages, config,
        // brand, llms, search, sitemap ...)
        invalidateContentCaches('webhook push')
        
        logger.info('All caches invalidated via webhook')
        
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
      logger.info('Webhook ping received')
      return {
        success: true,
        message: 'Pong! Webhook configured successfully.',
      }
    
    default:
      // Ignore other events
      logger.debug('Webhook event ignored', { event: githubEvent })
      return {
        success: true,
        message: `Event type '${githubEvent}' ignored`,
      }
  }
})
