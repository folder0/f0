/**
 * =============================================================================
 * F0 - CONTENT ASSETS API ENDPOINT
 * =============================================================================
 * 
 * GET /api/content/assets/[...path]
 * 
 * Serves static assets (images, files) from the content/assets directory.
 * Supports on-demand image processing via query parameters.
 * 
 * IMAGE PROCESSING (Phase 2.1):
 *   ?w=800       → Resize to 800px width
 *   ?h=600       → Resize to 600px height
 *   ?f=webp      → Convert to WebP format
 *   ?q=80        → Quality 80 (1-100)
 *   Combined:    ?w=800&f=webp&q=80
 * 
 * No params → serve original (backward compatible).
 * Processing fails → serve original (C-MEDIA-PROGRESSIVE-012).
 * 
 * SECURITY:
 * - Only serves files from content/assets directory
 * - Blocks path traversal attempts
 * - Returns appropriate MIME types
 */

import { readFile, stat } from 'fs/promises'
import { resolve, join, extname, normalize } from 'path'
import { lookup } from 'mrmime'
import { isProcessableImage, parseImageOptions, getProcessedImage } from '../../../utils/image-processor'
import { logger } from '../../../utils/logger'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const assetPath = event.context.params?.path || ''
  
  // Security: Block path traversal
  if (assetPath.includes('..') || assetPath.includes('//')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }
  
  // Resolve the full path
  const contentDir = resolve(process.cwd(), config.contentDir)
  const assetsDir = join(contentDir, 'assets')
  const filePath = normalize(join(assetsDir, assetPath))
  
  // Security: Ensure the resolved path is within assets directory
  if (!filePath.startsWith(assetsDir)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Forbidden',
    })
  }
  
  try {
    // Check if file exists
    const stats = await stat(filePath)
    
    if (!stats.isFile()) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
      })
    }
    
    // Check for image processing parameters
    const query = getQuery(event)
    const imageOptions = parseImageOptions(query)
    
    if (imageOptions && isProcessableImage(filePath)) {
      // Attempt image processing
      const cacheDir = join(contentDir, '.cache', 'images')
      const processed = await getProcessedImage(filePath, cacheDir, imageOptions)
      
      if (processed) {
        setHeader(event, 'Content-Type', processed.mimeType)
        setHeader(event, 'X-Content-Type-Options', 'nosniff')
        setHeader(event, 'Content-Length', processed.buffer.length)
        setHeader(event, 'Cache-Control', 'public, max-age=604800') // 7 days for processed
        setHeader(event, 'X-Image-Processed', 'true')
        return processed.buffer
      }
      
      // Fall through to serve original if processing failed
      // (C-MEDIA-PROGRESSIVE-012: never block on optimization)
      logger.debug('Image processing failed, serving original', { path: assetPath })
    }
    
    // Serve original file
    const content = await readFile(filePath)
    
    // Determine MIME type
    const ext = extname(filePath).toLowerCase()
    const mimeType = lookup(ext) || 'application/octet-stream'
    
    // Set headers
    setHeader(event, 'Content-Type', mimeType)
    setHeader(event, 'Content-Length', content.length)
    setHeader(event, 'X-Content-Type-Options', 'nosniff')
    if (ext === '.svg') {
      // An SVG opened directly is a document that can run script. Sandbox it.
      setHeader(event, 'Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
    }
    setHeader(event, 'Cache-Control', 'public, max-age=86400') // 24 hours for originals
    
    return content
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: { message: `Asset not found: ${assetPath}` },
      })
    }
    
    // Re-throw HTTP errors
    if (error && typeof error === 'object' && 'statusCode' in error) {
      throw error
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
    })
  }
})
