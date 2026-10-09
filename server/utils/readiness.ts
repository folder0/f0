/**
 * =============================================================================
 * F0 - WARM-UP STATE
 * =============================================================================
 *
 * The startup check renders every page and precomputes /llms.txt before the
 * instance should take traffic. /_ready reports "warming_up" (503) until that
 * finishes, so health checks and rolling deploys only switch over to an
 * instance that answers its first requests quickly.
 *
 * The gate is bounded: a very large site still warming after
 * WARMUP_GATE_MAX_SECONDS reports ready anyway (pages then render on first
 * request), so the image's health check (about 70s of grace) and Coolify's
 * never fail a deploy just because warm-up is slow.
 */

import { logger } from './logger'

export const WARMUP_GATE_MAX_SECONDS = 45

let warm = false
let gaveUpWaiting = false

/** Called once by the startup check when warm-up has finished (or failed). */
export function markWarm(): void {
  warm = true
}

export function isWarm(): boolean {
  if (warm) return true
  if (process.uptime() > WARMUP_GATE_MAX_SECONDS) {
    if (!gaveUpWaiting) {
      gaveUpWaiting = true
      logger.warn(`Warm-up still running after ${WARMUP_GATE_MAX_SECONDS}s; reporting ready so the deploy can proceed`)
    }
    return true
  }
  return false
}
