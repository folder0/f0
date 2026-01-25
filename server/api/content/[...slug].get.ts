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
 * EXAMPLES:
 * - GET /api/content/guides/getting-started
 * - GET /api/content/api/reference
 * 
 * RESPONSE (Markdown):
 * {
 *   "type": "markdown",
 *   "title": "Getting Started",
 *   "html": "<h1>Getting Started</h1>...",
 *   "toc": [...],
 *   "frontmatter": {...}
 * }
 * 
 * RESPONSE (API Spec):
 * {
 *   "type": "openapi" | "postman",
 *   "title": "API Reference",
 *   "spec": {...}
 * }
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-ARCH-FILESYSTEM-SOT-001: Content loaded from filesystem
 * - C-SEC-PRIVATE-NOT-PUBLIC-005: /private paths blocked
 */

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { parseMarkdown, isMarkdownFile, isJsonSpecFile } from '../../utils/markdown'
import { resolveContentPath, getContentMeta } from '../../utils/navigation'
import { parseApiSpec } from '../../utils/openapi-parser'

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
    
    // Read and parse content based on file type
    const content = await readFile(filePath, 'utf-8')
    
    if (isMarkdownFile(filePath)) {
      // Parse markdown
      const parsed = await parseMarkdown(content)
      
      return {
        type: 'markdown',
        title: parsed.title,
        html: parsed.html,
        toc: parsed.toc,
        frontmatter: parsed.frontmatter,
        path: `/${contentSlug}`,
      }
    }
    
    if (isJsonSpecFile(filePath)) {
      // Parse API spec
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
        // Include raw spec for download
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
    
    console.error(`[Content] Error loading ${contentSlug}:`, error)
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to load content' },
    })
  }
})
