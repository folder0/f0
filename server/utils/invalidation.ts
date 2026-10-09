/**
 * =============================================================================
 * F0 - CONTENT CHANGE REGISTRY
 * =============================================================================
 *
 * Every in-memory cache derived from content registers here, so one call
 * (webhook push, admin upload) clears all of them. Before this, the webhook
 * cleared five caches by name and missed search, agent search, sitemap and
 * llms-index.txt.
 *
 * Route handlers load lazily; a cache registers when its module first loads,
 * which is also the first moment it can hold anything.
 */

import { logger } from './logger'

const invalidators = new Map<string, () => void>()

/** Register a cache to clear when content changes. Re-registering replaces. */
export function onContentChange(name: string, invalidate: () => void): void {
  invalidators.set(name, invalidate)
}

/** Clear every registered content cache. Returns the names cleared. */
export function invalidateContentCaches(reason: string): string[] {
  const cleared: string[] = []
  for (const [name, invalidate] of invalidators) {
    try {
      invalidate()
      cleared.push(name)
    }
    catch (error) {
      logger.warn('Cache invalidation failed', { cache: name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  logger.info('Content caches invalidated', { reason, caches: cleared })
  return cleared
}
