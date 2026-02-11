/**
 * =============================================================================
 * F0 - SITEMAP.XML ROUTE
 * =============================================================================
 * 
 * GET /sitemap.xml
 * 
 * Auto-generated sitemap from the content directory for search engine crawling.
 * Each content page becomes an entry with:
 * - lastmod from file mtime
 * - changefreq based on directory type (blog=weekly, docs=monthly)
 * - priority based on depth (root=1.0, nested=0.8, deep=0.6)
 * 
 * Cached using content-hash invalidation (same as /llms.txt).
 */

import { readdir, stat } from 'fs/promises'
import { join, resolve, extname } from 'path'
import { isMarkdownFile, isJsonSpecFile } from '../utils/markdown'
import { resolveLayoutForPath } from '../utils/config'
import { logger } from '../utils/logger'
import { createHash } from 'crypto'

// =============================================================================
// TYPES
// =============================================================================

interface SitemapEntry {
  loc: string
  lastmod: string
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  priority: number
}

// =============================================================================
// CACHE
// =============================================================================

let cachedSitemap: string | null = null
let cachedSitemapHash: string | null = null

// =============================================================================
// CONTENT SCANNING
// =============================================================================

async function collectPages(
  dir: string,
  contentDir: string,
  urlPath: string = ''
): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = []

  try {
    const dirEntries = await readdir(dir, { withFileTypes: true })

    for (const entry of dirEntries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'nav.md' || entry.name === 'assets' || entry.name === 'images') continue

      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        const childUrl = urlPath ? `${urlPath}/${entry.name}` : `/${entry.name}`
        const children = await collectPages(fullPath, contentDir, childUrl)
        entries.push(...children)
      } else if (isMarkdownFile(entry.name) || isJsonSpecFile(entry.name)) {
        // Build URL path
        const slug = entry.name
          .replace(/^\d{4}-\d{2}-\d{2}-/, '')  // Strip date prefix
          .replace(/^\d+-/, '')                  // Strip order prefix
          .replace(extname(entry.name), '')      // Strip extension

        // Special case: home.md → /
        let pagePath: string
        if (!urlPath && slug === 'home') {
          pagePath = '/'
        } else {
          pagePath = urlPath ? `${urlPath}/${slug}` : `/${slug}`
        }

        // Get file stats for lastmod
        let lastmod: string
        try {
          const stats = await stat(fullPath)
          lastmod = stats.mtime.toISOString().split('T')[0]
        } catch {
          lastmod = new Date().toISOString().split('T')[0]
        }

        // Determine changefreq and priority based on content type and depth
        const depth = pagePath.split('/').filter(Boolean).length
        const layout = resolveLayoutForPath(contentDir, pagePath)

        let changefreq: SitemapEntry['changefreq'] = 'monthly'
        let priority = 0.8

        if (pagePath === '/') {
          changefreq = 'weekly'
          priority = 1.0
        } else if (layout === 'blog') {
          changefreq = 'weekly'
          priority = 0.7
        } else if (depth === 1) {
          changefreq = 'monthly'
          priority = 0.8
        } else if (depth >= 2) {
          changefreq = 'monthly'
          priority = 0.6
        }

        entries.push({ loc: pagePath, lastmod, changefreq, priority })
      }
    }
  } catch (error) {
    logger.warn('Error scanning directory for sitemap', {
      path: dir,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return entries
}

/**
 * Content hash for cache invalidation.
 */
async function computeSitemapHash(contentDir: string): Promise<string> {
  const parts: string[] = []

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
            parts.push(`${fullPath}:${s.mtimeMs}`)
          } catch {}
        }
      }
    } catch {}
  }

  await walk(contentDir)
  parts.sort()
  return createHash('md5').update(parts.join('\n')).digest('hex')
}

// =============================================================================
// XML GENERATION
// =============================================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildSitemapXml(entries: SitemapEntry[], baseUrl: string): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ]

  for (const entry of entries) {
    const url = entry.loc === '/'
      ? baseUrl
      : `${baseUrl}${entry.loc}`

    lines.push('  <url>')
    lines.push(`    <loc>${escapeXml(url)}</loc>`)
    lines.push(`    <lastmod>${entry.lastmod}</lastmod>`)
    lines.push(`    <changefreq>${entry.changefreq}</changefreq>`)
    lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`)
    lines.push('  </url>')
  }

  lines.push('</urlset>')
  return lines.join('\n')
}

// =============================================================================
// ROUTE HANDLER
// =============================================================================

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const contentDir = resolve(process.cwd(), config.contentDir)

  // Determine base URL from config or request
  const requestUrl = getRequestURL(event)
  const baseUrl = config.public.siteUrl
    || `${requestUrl.protocol}//${requestUrl.host}`

  try {
    // Check cache
    const currentHash = await computeSitemapHash(contentDir)
    if (cachedSitemap && cachedSitemapHash === currentHash) {
      setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
      setHeader(event, 'Cache-Control', 'public, max-age=3600')
      return cachedSitemap
    }

    // Generate
    const pages = await collectPages(contentDir, contentDir)

    // Sort: homepage first, then alphabetically
    pages.sort((a, b) => {
      if (a.loc === '/') return -1
      if (b.loc === '/') return 1
      return a.loc.localeCompare(b.loc)
    })

    const xml = buildSitemapXml(pages, baseUrl)

    // Cache
    cachedSitemap = xml
    cachedSitemapHash = currentHash

    logger.info('Sitemap generated', { pages: pages.length })

    setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=3600')
    return xml

  } catch (error) {
    logger.error('Failed to generate sitemap', {
      error: error instanceof Error ? error.message : String(error),
    })

    setHeader(event, 'Content-Type', 'application/xml; charset=utf-8')
    return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'
  }
})
