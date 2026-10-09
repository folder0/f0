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

import { basename, dirname, relative, resolve } from 'path'
import { isMarkdownFile, isJsonSpecFile, extractFrontmatter, generateExcerpt, calculateReadingTime, extractDateFromFilename } from '../../utils/markdown'
import { resolveContentPath } from '../../utils/navigation'
import { parseApiSpec } from '../../utils/openapi-parser'
import { resolveLayoutForPath, getConfigForPath } from '../../utils/config'
import { getCachedContent } from '../../utils/cache'
import { logger } from '../../utils/logger'
import { hasHiddenSegment } from '../../utils/paths'
import { f0Config } from '../../utils/f0-config'
import { fileToUrlPath, isDraft, resolveAssetUrl } from '../../utils/content-core'
import { pageChrome } from '../../utils/page-chrome'
import { listBlogPosts } from '../../utils/blog'
import { pagePartial } from '../../utils/partials'

export default defineEventHandler(async (event) => {
  const settings = f0Config()
  const slug = event.context.params?.slug || ''
  
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
      
      // Drafts: served at their URL but marked noindex, or hidden entirely
      // with F0_DRAFTS=404
      const draft = isDraft(cached.frontmatter)
      if (draft && settings.drafts === '404') {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' })
      }
      if (draft) {
        setHeader(event, 'X-Robots-Tag', 'noindex')
      }
      
      // Determine layout
      const layout = resolveLayoutForPath(settings.contentDir, contentSlug, filePath)
      
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
        draft,
      }
      
      // Markdown partials after the page (_partials/doc-footer.md or post-footer.md)
      const footer = await pagePartial(settings.contentDir, filePath, layout === 'blog' ? 'post-footer' : 'doc-footer')
      if (footer) {
        response.footerHtml = footer
      }
      
      // Breadcrumbs, previous/next and edit link (docs pages)
      if (layout === 'docs') {
        // Canonical URL from the file, so alias URLs (/guides/01-intro) match the sidebar
        response.chrome = await pageChrome(settings.contentDir, fileToUrlPath(relative(resolve(settings.contentDir), resolve(filePath))), filePath)
      }
      
      // Add blog metadata when layout is blog
      if (layout === 'blog') {
        const fm = cached.frontmatter
        const dirConfig = getConfigForPath(settings.contentDir, contentSlug, filePath)
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
        
        const blog: Record<string, unknown> = {
          date,
          author: (fm.author as string) || dirConfig.defaultAuthor || '',
          tags: Array.isArray(fm.tags) ? (fm.tags as string[]).map((t: unknown) => String(t).toLowerCase()) : [],
          coverImage: typeof fm.cover_image === 'string' && fm.cover_image.trim() ? resolveAssetUrl(fm.cover_image) : undefined,
          excerpt: (fm.excerpt as string) || generateExcerpt(bodyContent),
          pinned: fm.pinned === true,
          readingTime: calculateReadingTime(cached.rawMarkdown),
        }

        // Previous and next post from the folder's full list (not one page
        // of the index, which cut navigation off after the 10th post)
        const postUrl = fileToUrlPath(relative(resolve(settings.contentDir), resolve(filePath)))
        const urlBase = postUrl.slice(0, postUrl.lastIndexOf('/'))
        const posts = await listBlogPosts(dirname(resolve(filePath)), urlBase, dirConfig)
        const index = posts.findIndex(post => post.path === postUrl)
        const link = (post?: { title: string, path: string }) => (post ? { title: post.title, path: post.path } : null)
        blog.prev = index > 0 ? link(posts[index - 1]) : null
        blog.next = index >= 0 ? link(posts[index + 1]) : null
        response.blog = blog
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
