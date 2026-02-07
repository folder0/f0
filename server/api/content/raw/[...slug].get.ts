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
import { resolve, basename } from 'path'
import { resolveContentPath } from '../../../utils/navigation'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const slug = event.context.params?.slug || ''
  const query = getQuery(event)
  const download = query.download === 'true'
  
  // Security: Block private paths
  if (slug.includes('private') || slug.includes('..')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }
  
  // Handle home page
  const contentSlug = slug === '' ? 'home' : slug
  
  try {
    // Resolve slug to filesystem path
    const filePath = await resolveContentPath(config.contentDir, contentSlug)
    
    if (!filePath || !filePath.endsWith('.md')) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: { message: `Markdown content not found: ${contentSlug}` },
      })
    }
    
    // Read raw content
    const content = await readFile(filePath, 'utf-8')
    
    // Extract title for headers
    let title = ''
    const frontmatterMatch = content.match(/^---\n[\s\S]*?title:\s*["']?([^"'\n]+)["']?[\s\S]*?\n---\n/)
    if (frontmatterMatch) {
      title = frontmatterMatch[1]
    } else {
      const h1Match = content.match(/^#\s+(.+)$/m)
      title = h1Match ? h1Match[1] : basename(filePath, '.md')
    }
    
    // Calculate word count (rough estimate)
    const wordCount = content.split(/\s+/).length
    
    // Set headers
    setHeader(event, 'Content-Type', 'text/markdown; charset=utf-8')
    setHeader(event, 'X-Page-Title', title)
    setHeader(event, 'X-Page-Path', `/${contentSlug}`)
    setHeader(event, 'X-Word-Count', String(wordCount))
    setHeader(event, 'Cache-Control', 'public, max-age=300') // 5 minute cache
    
    // Set download header if requested
    if (download) {
      const filename = contentSlug.replace(/\//g, '-') + '.md'
      setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
    }
    
    return content
    
  } catch (error) {
    // Re-throw HTTP errors
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    
    console.error(`[RawContent] Error loading ${contentSlug}:`, error)
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to load content' },
    })
  }
})
