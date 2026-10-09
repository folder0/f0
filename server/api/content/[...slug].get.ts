/**
 * =============================================================================
 * F0 - CONTENT API ENDPOINT
 * =============================================================================
 * 
 * GET /api/content/[...slug]
 * 
 * Fetches and renders content for a given URL path.
 * Supports markdown files and API spec files (OpenAPI/Postman).
 * 
 * ENHANCEMENT: Phase 1.1 — Uses mtime-based content cache to avoid
 * re-parsing unchanged Markdown files. Cache hit serves in <2ms vs
 * 50-200ms for a full pipeline run.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-ARCH-FILESYSTEM-SOT-001: Content loaded from filesystem
 * - C-SEC-PRIVATE-NOT-PUBLIC-005: /private paths blocked
 * - C-PERF-CACHE-MTIME-010: Cache invalidation uses filesystem mtime
 */

import { basename } from 'path'
import { isMarkdownFile, isJsonSpecFile, extractFrontmatter, generateExcerpt, calculateReadingTime, extractDateFromFilename } from '../../utils/markdown'
import { resolveContentPath } from '../../utils/navigation'
import { parseApiSpec } from '../../utils/openapi-parser'
import { resolveLayoutForPath, getConfigForPath } from '../../utils/config'
import { getCachedContent } from '../../utils/cache'
import { logger } from '../../utils/logger'
import { hasHiddenSegment } from '../../utils/paths'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const slug = event.context.params?.slug || ''
  
  // Security: Block private paths
  if (slug.includes('private') || slug.includes('..')) {
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
    const filePath = await resolveContentPath(config.contentDir, contentSlug)
    
    if (!filePath) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: { message: `Content not found: ${contentSlug}` },
      })
    }
    
    if (isMarkdownFile(filePath)) {
      // Use mtime-based cache — stat() + Map lookup on hit, full pipeline on miss
      const cached = await getCachedContent(filePath)
      
      // Determine layout
      const layout = resolveLayoutForPath(config.contentDir, contentSlug)
      
      // Base response
      const response: Record<string, unknown> = {
        type: 'markdown',
        title: cached.title,
        html: cached.html,
        toc: cached.toc,
        frontmatter: cached.frontmatter,
        markdown: cached.rawMarkdown,
        path: `/${contentSlug}`,
        layout,
      }
      
      // Add blog metadata when layout is blog
      if (layout === 'blog') {
        const fm = cached.frontmatter
        const dirConfig = getConfigForPath(config.contentDir, contentSlug)
        const { content: bodyContent } = extractFrontmatter(cached.rawMarkdown)
        const filename = basename(filePath)
        
        // Resolve date
        let date: string
        if (fm.date) {
          const d = fm.date
          if (d instanceof Date) {
            date = d.toISOString().split('T')[0]
          } else {
            date = String(d)
          }
        } else {
          const filenameDate = extractDateFromFilename(filename)
          if (filenameDate) {
            date = filenameDate
          } else {
            date = new Date().toISOString().split('T')[0]
          }
        }
        
        response.blog = {
          date,
          author: (fm.author as string) || dirConfig.defaultAuthor || '',
          tags: Array.isArray(fm.tags) ? (fm.tags as string[]).map((t: unknown) => String(t).toLowerCase()) : [],
          coverImage: (fm.cover_image as string) || undefined,
          excerpt: (fm.excerpt as string) || generateExcerpt(bodyContent),
          pinned: fm.pinned === true,
          readingTime: calculateReadingTime(cached.rawMarkdown),
        }
      }
      
      return response
    }
    
    if (isJsonSpecFile(filePath)) {
      // Parse API spec (not cached — specs are infrequently accessed)
      const spec = await parseApiSpec(filePath)
      
      return {
        type: spec.format,
        title: spec.title,
        spec: {
          title: spec.title,
          description: spec.description,
          version: spec.version,
          baseUrl: spec.baseUrl,
          groups: spec.groups,
          securitySchemes: spec.securitySchemes,
        },
        rawSpec: spec.rawSpec,
        path: `/${contentSlug}`,
      }
    }
    
    // Unknown file type
    throw createError({
      statusCode: 415,
      statusMessage: 'Unsupported Media Type',
      data: { message: 'Unsupported content type' },
    })
    
  } catch (error) {
    // Re-throw HTTP errors
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    
    logger.error('Error loading content', { slug: contentSlug, error: error instanceof Error ? error.message : String(error) })
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to load content' },
    })
  }
})
