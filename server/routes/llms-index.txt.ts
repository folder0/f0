/**
 * =============================================================================
 * F0 - /llms-index.txt ROUTE
 * =============================================================================
 * 
 * GET /llms-index.txt
 * 
 * Returns a table of contents of available documentation sections with
 * page counts and token estimates. This is the f0 equivalent of a robots.txt
 * for AI — it tells agents what's available and how large each section is
 * so they can make smart decisions about what to fetch.
 * 
 * OUTPUT:
 * ```
 * # Acme Docs — Documentation Index
 * > Generated: 2026-02-11T15:00:00Z
 * 
 * ## Available Sections
 * 
 * /guides          — 15 pages, ~12,000 tokens
 * /guides/auth     — 4 pages, ~3,200 tokens
 * /api             — 8 pages, ~6,500 tokens
 * 
 * ## Full Site: 29 pages, ~23,500 tokens
 * 
 * ## Access
 * GET /llms.txt                    → Full documentation
 * GET /llms.txt?section=guides     → Guides only
 * ```
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, resolve } from 'path'
import { logger } from '../utils/logger'
import { markdownToPlainText, isMarkdownFile, extractFrontmatterSafe } from '../utils/markdown'

// =============================================================================
// TYPES
// =============================================================================

interface SectionInfo {
  path: string
  pages: number
  estimatedTokens: number
  children: Map<string, SectionInfo>
}

// =============================================================================
// CACHE
// =============================================================================

let cachedIndex: string | null = null
let cachedIndexHash: string | null = null

// =============================================================================
// CONTENT SCANNING
// =============================================================================

/**
 * Scan the content directory and compute per-section stats.
 */
async function scanSections(contentDir: string): Promise<Map<string, SectionInfo>> {
  const sections = new Map<string, SectionInfo>()

  async function walk(dir: string, sectionPath: string): Promise<{ pages: number; tokens: number }> {
    let totalPages = 0
    let totalTokens = 0

    try {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        if (entry.name === 'nav.md' || entry.name === 'assets' || entry.name === 'images') continue

        const fullPath = join(dir, entry.name)

        if (entry.isDirectory()) {
          const childPath = sectionPath ? `${sectionPath}/${entry.name}` : `/${entry.name}`
          const childStats = await walk(fullPath, childPath)

          if (childStats.pages > 0) {
            sections.set(childPath, {
              path: childPath,
              pages: childStats.pages,
              estimatedTokens: childStats.tokens,
              children: new Map(),
            })
          }

          totalPages += childStats.pages
          totalTokens += childStats.tokens
        } else if (isMarkdownFile(entry.name)) {
          totalPages++
          try {
            const content = await readFile(fullPath, 'utf-8')
            // Rough token estimate: ~4 chars per token for English
            const plainText = markdownToPlainText(content)
            totalTokens += Math.ceil(plainText.length / 4)
          } catch {
            totalTokens += 250 // Fallback estimate
          }
        }
      }
    } catch {
      // Directory not readable
    }

    return { pages: totalPages, tokens: totalTokens }
  }

  // Walk top-level directories
  try {
    const topEntries = await readdir(contentDir, { withFileTypes: true })

    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'assets' || entry.name === 'images') continue

      const sectionPath = `/${entry.name}`
      const fullPath = join(contentDir, entry.name)
      const stats = await walk(fullPath, sectionPath)

      if (stats.pages > 0) {
        sections.set(sectionPath, {
          path: sectionPath,
          pages: stats.pages,
          estimatedTokens: stats.tokens,
          children: new Map(),
        })
      }
    }

    // Count root-level pages
    let rootPages = 0
    let rootTokens = 0
    for (const entry of topEntries) {
      if (entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'nav.md') continue
      if (isMarkdownFile(entry.name)) {
        rootPages++
        try {
          const content = await readFile(join(contentDir, entry.name), 'utf-8')
          rootTokens += Math.ceil(markdownToPlainText(content).length / 4)
        } catch {
          rootTokens += 250
        }
      }
    }

    if (rootPages > 0) {
      sections.set('/', {
        path: '/',
        pages: rootPages,
        estimatedTokens: rootTokens,
        children: new Map(),
      })
    }
  } catch (error) {
    logger.error('Failed to scan sections for index', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return sections
}

/**
 * Build a content hash for cache invalidation.
 */
async function computeIndexHash(contentDir: string): Promise<string> {
  const { createHash } = await import('crypto')
  const entries: string[] = []

  async function walk(dir: string): Promise<void> {
    try {
      const dirEntries = await readdir(dir, { withFileTypes: true })
      for (const entry of dirEntries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        if (entry.name === 'assets' || entry.name === 'images' || entry.name === 'nav.md') continue
        const fullPath = join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(fullPath)
        } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
          try {
            const s = await stat(fullPath)
            entries.push(`${fullPath}:${s.mtimeMs}`)
          } catch {}
        }
      }
    } catch {}
  }

  await walk(contentDir)
  entries.sort()
  return createHash('md5').update(entries.join('\n')).digest('hex')
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const contentDir = resolve(process.cwd(), config.contentDir)
  const siteName = config.public.siteName || 'f0'

  try {
    // Check cache
    const currentHash = await computeIndexHash(contentDir)
    if (cachedIndex && cachedIndexHash === currentHash) {
      setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
      setHeader(event, 'Cache-Control', 'public, max-age=3600')
      return cachedIndex
    }

    // Generate index
    const sections = await scanSections(contentDir)

    // Calculate totals
    let totalPages = 0
    let totalTokens = 0
    for (const [path, info] of sections) {
      if (path.split('/').filter(Boolean).length <= 1) {
        totalPages += info.pages
        totalTokens += info.estimatedTokens
      }
    }

    // Build output
    const lines: string[] = []
    lines.push(`# ${siteName} — Documentation Index`)
    lines.push(`> Generated: ${new Date().toISOString()}`)
    lines.push('')
    lines.push('## Available Sections')
    lines.push('')

    // Sort sections by path
    const sortedSections = [...sections.entries()]
      .filter(([path]) => path !== '/')
      .sort(([a], [b]) => a.localeCompare(b))

    // Find max path length for alignment
    const maxLen = Math.max(...sortedSections.map(([p]) => p.length), 10)

    for (const [path, info] of sortedSections) {
      const padding = ' '.repeat(Math.max(1, maxLen - path.length + 2))
      lines.push(`${path}${padding}— ${info.pages} page${info.pages !== 1 ? 's' : ''}, ~${info.estimatedTokens.toLocaleString()} tokens`)
    }

    // Root pages
    const rootSection = sections.get('/')
    if (rootSection) {
      const padding = ' '.repeat(Math.max(1, maxLen - 1))
      lines.push(`/${padding}— ${rootSection.pages} root page${rootSection.pages !== 1 ? 's' : ''}, ~${rootSection.estimatedTokens.toLocaleString()} tokens`)
    }

    lines.push('')
    lines.push(`## Full Site: ${totalPages} pages, ~${totalTokens.toLocaleString()} tokens`)
    lines.push('')
    lines.push('## Access')
    lines.push('')
    lines.push('GET /llms.txt                    → Full documentation')

    for (const [path] of sortedSections.filter(([p]) => p.split('/').filter(Boolean).length === 1)) {
      const section = path.replace(/^\//, '')
      const padding = ' '.repeat(Math.max(1, 24 - section.length))
      lines.push(`GET /llms.txt?section=${section}${padding}→ ${section.charAt(0).toUpperCase() + section.slice(1)} only`)
    }

    lines.push('')

    const output = lines.join('\n')

    // Cache it
    cachedIndex = output
    cachedIndexHash = currentHash

    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=3600')
    return output

  } catch (error) {
    logger.error('Failed to generate /llms-index.txt', {
      error: error instanceof Error ? error.message : String(error),
    })

    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return `# Error\n\nFailed to generate documentation index.\n`
  }
})
