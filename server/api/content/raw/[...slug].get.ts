/**
 * =============================================================================
 * F0 - RAW MARKDOWN API ENDPOINT
 * =============================================================================
 * 
 * GET /api/content/raw/[...slug]
 * 
 * Returns the raw markdown content for a given page.
 * Designed for AI agents, copy functionality, and programmatic access.
 * 
 * EXAMPLES:
 * - GET /api/content/raw/guides/getting-started
 * - GET /api/content/raw/guides/authentication/setup
 * 
 * QUERY PARAMETERS:
 * - download: If 'true', sets Content-Disposition header for file download
 * 
 * RESPONSE:
 * Returns raw markdown text with Content-Type: text/markdown
 * 
 * HEADERS:
 * - Content-Type: text/markdown; charset=utf-8
 * - X-Page-Title: Page Title
 * - X-Page-Path: /guides/getting-started
 * - X-Word-Count: 450
 */

import { readFile } from 'fs/promises'
import { basename } from 'path'
import { resolveContentPath } from '../../../utils/navigation'
import { logger } from '../../../utils/logger'
import { hasHiddenSegment } from '../../../utils/paths'
import { f0Config } from '../../../utils/f0-config'
import { readFrontmatter, resolvePageTitle } from '../../../utils/content-core'

/** Percent-encode everything outside printable ASCII so the value is a valid header. */
function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/gu, char => encodeURIComponent(char))
}

export default defineEventHandler(async (event) => {
  const settings = f0Config()
  const slug = event.context.params?.slug || ''
  const query = getQuery(event)
  const download = query.download === 'true'
  
  // Security: Block private paths
  // A folder named 'private' is never content (substring matching used to
  // block pages such as guides/private-keys)
  const segments = slug.split('/')
  if (segments.includes('private') || segments.includes('..') || slug.includes('..')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }

  // Control and hidden files (_config.md, _brand.md, _drafts/, dotfiles) are
  // never pages: 404 rather than revealing that they exist.
  if (hasHiddenSegment(slug)) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
    })
  }
  
  // Handle home page
  const contentSlug = slug === '' ? 'home' : slug
  
  try {
    // Resolve slug to filesystem path
    const filePath = await resolveContentPath(settings.contentDir, contentSlug)
    
    if (!filePath || !filePath.endsWith('.md')) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: { message: `Markdown content not found: ${contentSlug}` },
      })
    }
    
    // Read raw content
    const content = await readFile(filePath, 'utf-8')
    
    // Same title rule as the page: frontmatter title, then first H1, then file name
    const title = resolvePageTitle(readFrontmatter(content), basename(filePath))
    
    // Calculate word count (rough estimate)
    const wordCount = content.split(/\s+/).length
    
    // Set headers
    setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
    // Header values must be Latin-1 without control characters, or Node throws
    // (a 500 for any title in Greek, CJK, emoji ...). Anything outside printable
    // ASCII is percent-encoded as UTF-8; plain ASCII titles are unchanged.
    setHeader(event, 'X-Page-Title', headerSafe(title))
    setHeader(event, 'X-Page-Path', headerSafe(`/${contentSlug}`))
    setHeader(event, 'X-Word-Count', String(wordCount))
    setHeader(event, 'Cache-Control', 'public, max-age=300') // 5 minute cache
    
    // Set download header if requested
    if (download) {
      const filename = contentSlug.replace(/\//g, '-') + '.md'
      // ASCII fallback plus the exact UTF-8 name (RFC 6266 / RFC 8187)
      const asciiName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
      setHeader(event, 'Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
    }
    
    return content
    
  } catch (error) {
    // Re-throw HTTP errors
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    
    logger.error('Error loading raw content', { slug: contentSlug })
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to load content' },
    })
  }
})
