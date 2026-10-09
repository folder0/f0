/**
 * =============================================================================
 * F0 - ADMIN FILE UPLOAD API
 * =============================================================================
 * 
 * POST /api/admin/upload
 * 
 * Allows authenticated admins to upload content files via the web interface.
 * This provides an alternative to git-based content management.
 * 
 * SUPPORTED FILES:
 * - Markdown (.md)
 * - OpenAPI specs (.json with openapi/swagger key)
 * - Postman collections (.json with postman schema)
 * - Images (.png, .jpg, .jpeg, .gif, .webp); SVG is rejected (can carry script)
 * 
 * REQUEST:
 * - Content-Type: multipart/form-data
 * - Fields:
 *   - file: The file to upload
 *   - path: Destination path within /content (e.g., "guides/new-doc.md")
 * 
 * SECURITY:
 * - Requires authentication (handled by middleware)
 * - Validates file types
 * - Sanitizes paths to prevent directory traversal
 * - Size limit: 10MB
 */

import { writeFile, mkdir } from 'fs/promises'
import { join, dirname, extname, normalize } from 'path'
import { invalidateNavigationCache } from '../../utils/navigation'
import { invalidateContentCache } from '../../utils/cache'
import { invalidateConfigCache } from '../../utils/config'
import { invalidateLlmsCache } from '../../utils/llms-cache'
import { invalidateBrandCache } from '../../utils/brand'
import { assertAdmin } from '../../utils/admin'
import { logger } from '../../utils/logger'
import { f0Config } from '../../utils/f0-config'

// =============================================================================
// CONFIGURATION
// =============================================================================

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

const ALLOWED_EXTENSIONS = [
  '.md',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  // .svg is deliberately not accepted: SVG can carry script. Add SVGs through
  // git, where they are reviewed; they are served sandboxed (see assets route).
]

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate and sanitize upload path
 * Prevents directory traversal and ensures path is within content directory
 */
function sanitizePath(inputPath: string): string | null {
  // Normalize the path
  let cleanPath = normalize(inputPath)
    .replace(/^[/\\]+/, '')  // Remove leading slashes
    .replace(/\.\./g, '')     // Remove path traversal
  
  // Block access to private directory
  if (cleanPath.toLowerCase().startsWith('private')) {
    return null
  }
  
  // Ensure it has an allowed extension
  const ext = extname(cleanPath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return null
  }
  
  return cleanPath
}

/**
 * Validate file content for JSON files
 */
function validateJsonFile(content: string): { valid: boolean; type?: string } {
  try {
    const json = JSON.parse(content)
    
    // Check for OpenAPI
    if (json.openapi || json.swagger) {
      return { valid: true, type: 'openapi' }
    }
    
    // Check for Postman
    if (json.info?.schema?.includes('schema.getpostman.com')) {
      return { valid: true, type: 'postman' }
    }
    
    // Generic JSON is not allowed (must be API spec)
    return { valid: false }
  } catch {
    return { valid: false }
  }
}

// =============================================================================
// HANDLER
// =============================================================================

export default defineEventHandler(async (event) => {
  const settings = f0Config()

  // Authorization: admin only, and never reachable in public mode.
  // (In public mode there is no login, so anonymous writes must be rejected.)
  const adminEmail = await assertAdmin(event)

  // Parse multipart form data
  const formData = await readMultipartFormData(event)
  
  if (!formData || formData.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'No file uploaded' },
    })
  }
  
  // Extract file and path from form data
  let fileData: { filename?: string; data: Buffer; type?: string } | null = null
  let targetPath: string | null = null
  
  for (const field of formData) {
    if (field.name === 'file' && field.data) {
      fileData = {
        filename: field.filename,
        data: field.data,
        type: field.type,
      }
    }
    if (field.name === 'path' && field.data) {
      targetPath = field.data.toString()
    }
  }
  
  if (!fileData || !fileData.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'File is required' },
    })
  }
  
  // Use filename if path not provided
  if (!targetPath && fileData.filename) {
    targetPath = fileData.filename
  }
  
  if (!targetPath) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Path or filename is required' },
    })
  }
  
  // Check file size
  if (fileData.data.length > MAX_FILE_SIZE) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      data: { message: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
    })
  }
  
  // Sanitize path
  const cleanPath = sanitizePath(targetPath)
  if (!cleanPath) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      data: { message: 'Invalid file path or unsupported file type' },
    })
  }
  
  // Validate JSON files
  const ext = extname(cleanPath).toLowerCase()
  if (ext === '.json') {
    const validation = validateJsonFile(fileData.data.toString())
    if (!validation.valid) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request',
        data: { message: 'JSON files must be OpenAPI or Postman specifications' },
      })
    }
  }
  
  // Build full path
  const fullPath = join(settings.contentDir, cleanPath)
  
  try {
    // Ensure directory exists
    await mkdir(dirname(fullPath), { recursive: true })
    
    // Write file
    await writeFile(fullPath, fileData.data)
    
    // Invalidate all caches
    invalidateNavigationCache()
    invalidateContentCache()
    invalidateConfigCache()
    invalidateLlmsCache()
    invalidateBrandCache()
    
    logger.info('File uploaded', { path: cleanPath, email: adminEmail })
    
    return {
      success: true,
      message: 'File uploaded successfully',
      path: `/${cleanPath.replace(/\.(md|json)$/, '')}`,
      filename: cleanPath,
    }
    
  } catch (error) {
    logger.error('Failed to save uploaded file', { path: cleanPath, error: error instanceof Error ? error.message : String(error) })
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to save file' },
    })
  }
})
