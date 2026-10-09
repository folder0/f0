/**
 * =============================================================================
 * F0 - WARM-UP STATE
 * =============================================================================
 *
 * The startup check renders the pages visitors land on first (home, top
 * navigation targets, the first page of each section) before the instance
 * should take traffic. /_ready reports "warming_up" (503) until that finishes,
 * so health checks and rolling deploys only switch over to an instance that
 * answers its first requests quickly. The rest of the site warms afterwards in
 * the background.
 *
 * The gate is bounded: an instance still warming after
 * WARMUP_GATE_MAX_SECONDS reports ready anyway (pages then render on first
 * request), so health checks never fail a deploy just because warm-up is slow.
 */

import { logger } from './logger'

export const WARMUP_GATE_MAX_SECONDS = 20

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
