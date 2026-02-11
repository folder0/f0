/**
 * =============================================================================
 * F0 - PARSED CONTENT CACHE
 * =============================================================================
 * 
 * In-memory cache for parsed Markdown content, keyed by file path and
 * invalidated by filesystem mtime comparison.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-PERF-CACHE-MTIME-010: Invalidation uses filesystem mtime, never TTL.
 * 
 * DESIGN DECISIONS:
 * - Cache keyed on absolute file path. Simple, collision-free.
 * - Invalidation by mtime comparison: on every request, stat() the file
 *   (~0.1ms) and compare mtime against cached version. If unchanged, skip
 *   the entire remark/rehype pipeline.
 * - No TTL-based expiry. Content changes when files change, period.
 * - In-process memory. No Redis, no external dependencies. Correct for
 *   single-instance deployments (f0's target model).
 * - Bounded by number of content files. 500 pages × 20KB avg = ~10MB heap.
 * 
 * PERFORMANCE TARGET:
 * - Cache hit: <2ms (stat + Map lookup)
 * - Cache miss: 50-200ms (full remark/rehype pipeline)
 * - Target p95 cached response: <20ms
 */

import { stat, readFile } from 'fs/promises'
import { resolve } from 'path'
import { parseMarkdownSafe, type ParsedMarkdown } from './markdown'
import { logger } from './logger'
import { validateAndLogAssets } from './asset-validator'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface CacheEntry {
  /** Rendered HTML content */
  html: string
  /** Table of contents items */
  toc: ParsedMarkdown['toc']
  /** Extracted frontmatter metadata */
  frontmatter: ParsedMarkdown['frontmatter']
  /** Plain text version for LLM output */
  plainText: string
  /** Resolved page title */
  title: string
  /** Raw markdown content (for blog metadata, raw endpoint, etc.) */
  rawMarkdown: string
  /** File modification timestamp (ms) */
  mtime: number
  /** When this entry was parsed (ms since epoch) */
  parsedAt: number
}

export interface CacheStats {
  /** Number of entries in cache */
  entries: number
  /** Total cache hits since startup */
  hits: number
  /** Total cache misses since startup */
  misses: number
  /** Approximate memory usage in bytes */
  estimatedBytes: number
}

// =============================================================================
// CACHE IMPLEMENTATION
// =============================================================================

const contentCache = new Map<string, CacheEntry>()

let cacheHits = 0
let cacheMisses = 0

/**
 * Get cached parsed content for a file path.
 * 
 * On every call:
 * 1. stat() the file to get current mtime (~0.1ms)
 * 2. If cached entry exists and mtime matches → return cached (cache hit)
 * 3. Otherwise → read file, run full parse pipeline, cache result (cache miss)
 * 
 * @param filePath - Absolute path to the markdown file
 * @returns Parsed content with HTML, TOC, frontmatter, plain text
 */
export async function getCachedContent(filePath: string): Promise<CacheEntry> {
  const startTime = performance.now()
  // Normalize to absolute path for consistent cache keys
  const absPath = resolve(filePath)

  // 1. Stat the file for current mtime
  const fileStats = await stat(absPath)
  const currentMtime = fileStats.mtimeMs

  // 2. Check cache
  const cached = contentCache.get(absPath)
  if (cached && cached.mtime === currentMtime) {
    cacheHits++
    return cached
  }

  // 3. Cache miss — read and parse
  cacheMisses++
  const rawMarkdown = await readFile(absPath, 'utf-8')
  const parsed = await parseMarkdownSafe(rawMarkdown, absPath)

  // 4. Validate image references (Phase 2.3)
  try {
    const config = useRuntimeConfig()
    const contentDir = resolve(process.cwd(), config.contentDir || './content')
    validateAndLogAssets(rawMarkdown, absPath, contentDir)
  } catch {
    // Validation is non-blocking — skip if config not available
  }

  const entry: CacheEntry = {
    html: parsed.html,
    toc: parsed.toc,
    frontmatter: parsed.frontmatter,
    plainText: parsed.plainText,
    title: parsed.title,
    rawMarkdown,
    mtime: currentMtime,
    parsedAt: Date.now(),
  }

  contentCache.set(absPath, entry)

  const duration = Math.round(performance.now() - startTime)
  logger.info('Content parsed (cache miss)', { path: filePath, duration })

  return entry
}

/**
 * Invalidate a specific cache entry.
 * Called when a file is known to have changed (e.g., webhook, upload).
 */
export function invalidateCacheEntry(filePath: string): void {
  contentCache.delete(resolve(filePath))
}

/**
 * Invalidate the entire content cache.
 * Called on webhook triggers or manual cache clear.
 */
export function invalidateContentCache(): void {
  const size = contentCache.size
  contentCache.clear()
  cacheHits = 0
  cacheMisses = 0
  logger.info('Content cache invalidated', { entriesCleared: size })
}

/**
 * Get cache statistics for monitoring.
 */
export function getContentCacheStats(): CacheStats {
  let estimatedBytes = 0
  for (const entry of contentCache.values()) {
    // Rough estimate: HTML + plainText + rawMarkdown + overhead
    estimatedBytes += (entry.html.length + entry.plainText.length + entry.rawMarkdown.length) * 2
  }

  return {
    entries: contentCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    estimatedBytes,
  }
}

/**
 * Pre-warm the cache for a list of file paths.
 * Called during startup to ensure first requests are fast.
 * 
 * @returns Count of successfully cached files and errors
 */
export async function prewarmCache(filePaths: string[]): Promise<{ cached: number; errors: number }> {
  let cached = 0
  let errors = 0

  for (const filePath of filePaths) {
    try {
      await getCachedContent(filePath)
      cached++
    } catch (err) {
      errors++
      logger.warn('Failed to pre-warm cache entry', {
        path: filePath,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { cached, errors }
}
