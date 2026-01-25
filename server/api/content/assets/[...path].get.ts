/**
 * =============================================================================
 * F0 - CONTENT ASSETS API ENDPOINT
 * =============================================================================
 * 
 * GET /api/content/assets/[...path]
 * 
 * Serves static assets (images, files) from the content/assets directory.
 * 
 * EXAMPLES:
 * - GET /api/content/assets/images/diagram.png
 * - GET /api/content/assets/files/example.pdf
 * 
 * SECURITY:
 * - Only serves files from content/assets directory
 * - Blocks path traversal attempts
 * - Returns appropriate MIME types
 */

import { readFile, stat } from 'fs/promises'
import { resolve, join, extname, normalize } from 'path'
import { lookup } from 'mrmime'

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
    
    // Read the file
    const content = await readFile(filePath)
    
    // Determine MIME type
    const ext = extname(filePath).toLowerCase()
    const mimeType = lookup(ext) || 'application/octet-stream'
    
    // Set headers
    setHeader(event, 'Content-Type', mimeType)
    setHeader(event, 'Content-Length', content.length)
    setHeader(event, 'Cache-Control', 'public, max-age=86400') // 24 hour cache
    
    return content
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw createError({
        statusCode: 404,
        statusMessage: 'Not Found',
        data: { message: `Asset not found: ${assetPath}` },
      })
    }
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
    })
  }
})
