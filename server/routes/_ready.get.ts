/**
 * =============================================================================
 * F0 - READINESS CHECK ENDPOINT
 * =============================================================================
 * 
 * GET /_ready
 * 
 * Returns 200 only if the instance can serve content — meaning:
 * 1. The content directory exists and is readable
 * 2. nav.md is present and parseable (if it exists)
 * 
 * An instance can be healthy (process running) but not ready (content
 * volume not mounted yet, permissions wrong, etc.).
 * 
 * Use for:
 * - Kubernetes readiness probes
 * - Coolify deploy verification
 * - Load balancer traffic routing
 * 
 * Returns 503 Service Unavailable if not ready, with diagnostic info.
 */

import { access, stat } from 'fs/promises'
import { constants } from 'fs'
import { logger } from '../utils/logger'
import { resolve, join } from 'path'

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const contentDir = resolve(process.cwd(), config.contentDir)

  const checks: Record<string, 'ok' | 'fail'> = {}

  try {
    // Check 1: Content directory exists and is readable
    await access(contentDir, constants.R_OK)
    checks.contentDir = 'ok'
  } catch {
    checks.contentDir = 'fail'
    // The path goes to the log, not the response: /_ready is unauthenticated.
    logger.error('Readiness check failed: content directory not accessible', { contentDir })
    throw createError({
      statusCode: 503,
      statusMessage: 'Not Ready',
      data: {
        status: 'not_ready',
        reason: 'Content directory not accessible',
        checks,
        timestamp: Date.now(),
      },
    })
  }

  try {
    // Check 2: nav.md exists (non-fatal — zero-config principle)
    await stat(join(contentDir, 'nav.md'))
    checks.navMd = 'ok'
  } catch {
    // nav.md is optional, just note it
    checks.navMd = 'fail'
  }

  return {
    status: 'ready',
    checks,
    timestamp: Date.now(),
  }
})
