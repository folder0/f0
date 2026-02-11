/**
 * =============================================================================
 * F0 - STARTUP VALIDATION PLUGIN
 * =============================================================================
 * 
 * Nitro plugin that runs before the server accepts requests.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-OPS-FAIL-FAST-013: Fatal misconfigurations detected at startup, not request time.
 * - C-OPS-ZERO-CONFIG-DEFAULT-008: Non-fatal issues produce warnings, not crashes.
 * 
 * CHECKS:
 * 1. Content directory exists → FATAL if missing
 * 2. nav.md exists → WARN if missing (zero-config principle)
 * 3. Private auth config → FATAL if AUTH_MODE=private but no allowlist
 * 4. Pre-warm content cache → all pages parsed at startup
 * 5. Pre-compute /llms.txt → ready for first request
 * 
 * PRINCIPLE: Fail fast on fatal misconfigurations (no content directory).
 * Warn on non-fatal issues (no nav.md). Pre-warm caches so the first
 * user request is fast.
 */

import { existsSync } from 'fs'
import { readdir } from 'fs/promises'
import { resolve, join } from 'path'
import { logger } from '../utils/logger'
import { prewarmCache } from '../utils/cache'
import { getCachedLlmsTxt } from '../utils/llms-cache'
import { isMarkdownFile } from '../utils/markdown'

/**
 * Recursively scan content directory for all markdown files.
 */
async function scanContentFiles(dir: string): Promise<string[]> {
  const files: string[] = []

  async function walk(currentDir: string): Promise<void> {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        if (entry.name === 'assets' || entry.name === 'images') continue
        if (entry.name === 'nav.md') continue

        const fullPath = join(currentDir, entry.name)

        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (isMarkdownFile(entry.name)) {
          files.push(fullPath)
        }
      }
    } catch {
      // Directory not readable
    }
  }

  await walk(dir)
  return files
}

export default defineNitroPlugin(async () => {
  const startTime = performance.now()
  logger.info('f0 startup validation starting')

  // Access runtime config
  const config = useRuntimeConfig()
  const contentDir = resolve(process.cwd(), config.contentDir || './content')

  // =========================================================================
  // CHECK 1: Content directory exists (FATAL)
  // =========================================================================

  if (!existsSync(contentDir)) {
    logger.error('Content directory not found', { path: contentDir })
    logger.error('Create the directory or set CONTENT_DIR environment variable')
    process.exit(1)
  }

  logger.info('Content directory found', { path: contentDir })

  // =========================================================================
  // CHECK 2: nav.md exists (WARN — zero-config principle)
  // =========================================================================

  const navPath = join(contentDir, 'nav.md')
  if (!existsSync(navPath)) {
    logger.warn('nav.md not found — top navigation will be empty', { path: contentDir })
  }

  // =========================================================================
  // CHECK 3: Auth configuration (FATAL if misconfigured)
  // =========================================================================

  const authMode = config.authMode || 'public'
  if (authMode === 'private') {
    const privateDir = resolve(process.cwd(), config.privateDir || './private')
    const allowlistPath = join(privateDir, 'allowlist.json')

    if (!existsSync(allowlistPath)) {
      logger.error('AUTH_MODE=private but allowlist.json not found', { path: allowlistPath })
      logger.error('Create the allowlist file or change AUTH_MODE to "public"')
      process.exit(1)
    }

    logger.info('Private auth mode: allowlist found', { path: allowlistPath })
  }

  // =========================================================================
  // CHECK 4: Pre-warm content cache
  // =========================================================================

  logger.info('Pre-warming content cache...')
  const contentFiles = await scanContentFiles(contentDir)
  const { cached, errors } = await prewarmCache(contentFiles)
  logger.info('Content cache warmed', { pages: cached, errors })

  // =========================================================================
  // CHECK 5: Pre-compute /llms.txt
  // =========================================================================

  try {
    const siteName = config.public?.siteName || 'f0'
    await getCachedLlmsTxt(contentDir, siteName)
    logger.info('/llms.txt pre-computed')
  } catch (error) {
    logger.warn('Failed to pre-compute /llms.txt', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  // =========================================================================
  // DONE
  // =========================================================================

  const duration = Math.round(performance.now() - startTime)
  logger.info('f0 startup validation complete', {
    duration,
    pages: cached,
    errors,
    authMode,
  })
})
