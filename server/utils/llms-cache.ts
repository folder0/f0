/**
 * =============================================================================
 * F0 - /llms.txt CACHE
 * =============================================================================
 * 
 * Pre-computes and caches the /llms.txt output. Invalidation uses a content
 * hash derived from all markdown file paths and their modification times.
 * 
 * Walking the directory tree and stat()-ing 100 files takes <5ms.
 * If the hash matches, we serve the cached string instantly.
 * If any file was added, removed, or modified, the hash changes and we regenerate.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-PERF-CACHE-MTIME-010: Uses mtime-derived content hash, never TTL
 * - C-AI-LLMS-NO-UI-NOISE-004: Output is identical — caching the result, not changing generation
 * - C-AI-TRIBRID-CONSISTENCY-003: Same source, same output, just faster
 */

import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { generateLlmText, getLlmStats, type LlmGeneratorOptions } from './llm-generator'
import { logger } from './logger'

// =============================================================================
// CACHE STATE
// =============================================================================

let cachedLlmsTxt: string | null = null
let cachedLlmsHash: string | null = null
let cachedLlmsGeneratedAt: number = 0

// Section-scoped cache, keyed by the ?section= values. Bounded LRU: section
// strings come from unauthenticated query parameters, so an unbounded Map would
// let arbitrary values grow memory without limit.
const SECTION_CACHE_MAX = 64
const sectionCache = new Map<string, { text: string; hash: string }>()

// =============================================================================
// CONTENT HASH
// =============================================================================

/**
 * Compute a lightweight hash of all content files' paths and mtimes.
 * This is much cheaper than reading file contents — walking 100 files
 * and stat()-ing them takes <5ms.
 * 
 * The hash changes when any file is added, removed, renamed, or modified.
 */
async function computeContentHash(dir: string): Promise<string> {
  const entries: string[] = []

  async function walk(currentDir: string): Promise<void> {
    try {
      const dirEntries = await readdir(currentDir, { withFileTypes: true })

      for (const entry of dirEntries) {
        // Skip hidden, config, and asset directories
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        if (entry.name === 'assets' || entry.name === 'images' || entry.name === 'nav.md') continue

        const fullPath = join(currentDir, entry.name)

        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
          try {
            const stats = await stat(fullPath)
            // Include both path and mtime in the hash input
            entries.push(`${fullPath}:${stats.mtimeMs}`)
          } catch {
            // File may have been deleted between readdir and stat
          }
        }
      }
    } catch {
      // Directory may not exist
    }
  }

  await walk(dir)

  // Sort for deterministic hash regardless of filesystem ordering
  entries.sort()

  const hash = createHash('md5')
    .update(entries.join('\n'))
    .digest('hex')

  return hash
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get the cached /llms.txt content. Returns the cached version if the
 * content hash hasn't changed; regenerates otherwise.
 * 
 * @param contentDir - Path to content directory
 * @param siteName - Site name for the header
 * @param options - Generation options (sections filter, etc.)
 * @returns The full /llms.txt string
 */
export async function getCachedLlmsTxt(
  contentDir: string,
  siteName: string = 'f0',
  options: LlmGeneratorOptions = {}
): Promise<string> {
  const startTime = performance.now()

  // If section-scoped, use section cache
  if (options.sections && options.sections.length > 0) {
    const sectionKey = options.sections.sort().join(',')
    const currentHash = await computeContentHash(contentDir)
    const cached = sectionCache.get(sectionKey)

    if (cached && cached.hash === currentHash) {
      // Refresh recency: re-insert at the end of the Map's insertion order
      sectionCache.delete(sectionKey)
      sectionCache.set(sectionKey, cached)
      return cached.text
    }

    const text = await generateLlmText(contentDir, siteName, options)
    sectionCache.delete(sectionKey)
    sectionCache.set(sectionKey, { text, hash: currentHash })
    while (sectionCache.size > SECTION_CACHE_MAX) {
      const oldest = sectionCache.keys().next().value
      if (oldest === undefined) break
      sectionCache.delete(oldest)
    }
    return text
  }

  // Full site cache
  const currentHash = await computeContentHash(contentDir)

  if (cachedLlmsTxt && cachedLlmsHash === currentHash) {
    logger.debug('/llms.txt served from cache', {
      size: cachedLlmsTxt.length,
      duration: Math.round(performance.now() - startTime),
    })
    return cachedLlmsTxt
  }

  // Cache miss — regenerate
  cachedLlmsTxt = await generateLlmText(contentDir, siteName, options)
  cachedLlmsHash = currentHash
  cachedLlmsGeneratedAt = Date.now()

  const duration = Math.round(performance.now() - startTime)
  logger.info('/llms.txt regenerated', {
    size: cachedLlmsTxt.length,
    estimatedTokens: Math.ceil(cachedLlmsTxt.length / 4),
    duration,
  })

  return cachedLlmsTxt
}

/**
 * Invalidate the llms.txt cache. Called on content changes.
 */
export function invalidateLlmsCache(): void {
  cachedLlmsTxt = null
  cachedLlmsHash = null
  cachedLlmsGeneratedAt = 0
  sectionCache.clear()
  logger.info('/llms.txt cache invalidated')
}

/**
 * Get cache status for monitoring.
 */
export function getLlmsCacheStatus(): {
  cached: boolean
  generatedAt: number
  size: number
  hash: string | null
} {
  return {
    cached: cachedLlmsTxt !== null,
    generatedAt: cachedLlmsGeneratedAt,
    size: cachedLlmsTxt?.length ?? 0,
    hash: cachedLlmsHash,
  }
}
