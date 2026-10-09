/**
 * =============================================================================
 * F0 - IMAGE PROCESSING PIPELINE
 * =============================================================================
 * 
 * On-demand image processing using sharp. Generates optimized variants on
 * first request and caches them to disk. Falls back to original on any failure.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-MEDIA-PROGRESSIVE-012: Original files always served if processing fails.
 *   Never block a request on image optimization.
 * - C-PERF-CACHE-MTIME-010: The variant key includes the source's mtime and size,
 *   so a changed source gets new variants.
 * 
 * API SURFACE:
 *   GET /api/content/assets/images/photo.png              → Original
 *   GET /api/content/assets/images/photo.png?w=800        → Resized to 800px
 *   GET /api/content/assets/images/photo.png?w=800&f=webp → Resized + WebP
 *   GET /api/content/assets/images/photo.png?w=400&q=80   → Resized, quality 80
 * 
 * DISK CACHE:
 *   <NUXT_IMAGE_CACHE_DIR>/photo-<hash of path, mtime, size>-w800.webp
 *   (default: the OS temp dir, never inside the content directory)
 */

import { readFile, writeFile, mkdir, rename, stat, unlink } from 'fs/promises'
import { createHash } from 'crypto'
import { join, dirname, basename, extname } from 'path'
import { logger } from './logger'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface ImageOptions {
  width?: number
  height?: number
  format?: 'webp' | 'avif' | 'jpeg' | 'jpg' | 'png' | 'original'
  quality?: number
}

export interface ProcessedImage {
  buffer: Buffer
  mimeType: string
  width?: number
  height?: number
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SUPPORTED_FORMATS = ['webp', 'avif', 'jpeg', 'jpg', 'png'] as const

// Requested sizes and qualities snap UP to these steps, so each source image
// has a bounded number of variants (unbounded ?w/?h/?q values were a CPU and
// disk exhaustion vector). The widths cover every size f0 itself emits, and the
// caps match the limits that applied before snapping (3840 wide, 2160 high,
// quality up to 100), so no URL that worked before gets a smaller image.
//
// Width and height snap independently. With fit: 'inside' the result is never
// smaller than requested; deriving one from the other would make the variant
// count unbounded again.
const SIZE_STEPS = [96, 160, 192, 320, 400, 800, 1200, 1600, 2400, 3840]
const QUALITY_STEPS = [60, 75, 80, 85, 90, 95, 100]
const MAX_WIDTH = 3840
const MAX_HEIGHT = 2160
const DEFAULT_QUALITY = 80

/** Smallest step >= value, or the largest step when value exceeds them all. */
function snapUp(value: number, steps: number[]): number {
  return steps.find(step => step >= value) ?? steps[steps.length - 1]
}
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.svg']

// =============================================================================
// SHARP LAZY LOADER
// =============================================================================

let sharpModule: Sharp | null = null
let sharpAvailable = true

type Sharp = typeof import('sharp')['default']

async function getSharp(): Promise<Sharp | null> {
  if (!sharpAvailable) return null
  if (sharpModule) return sharpModule

  try {
    sharpModule = (await import('sharp')).default
    return sharpModule
  } catch {
    logger.warn('sharp not available — image processing disabled, serving originals')
    sharpAvailable = false
    return null
  }
}

// =============================================================================
// CACHE KEY GENERATION
// =============================================================================

/**
 * Generate a cache filename for a processed image variant.
 * e.g. ".../guides/photo.png" with w=800, f=webp → "photo-1a2b3c4d5e6f-w800.webp"
 *
 * The short hash of the full source path keeps images that share a file name
 * in different folders (guides/shot.png, blog/shot.png) from colliding in the
 * flat cache directory and serving each other's pixels.
 */
function getCacheKey(sourcePath: string, source: { mtimeMs: number, size: number }, options: ImageOptions): string {
  const name = basename(sourcePath, extname(sourcePath))
  // The source's mtime and size are part of the key, so replacing an image
  // (even with an older mtime, as rsync -t or cp -p do) never serves the old
  // pixels.
  const pathHash = createHash('sha1')
    .update(`${sourcePath}\0${source.mtimeMs}\0${source.size}`)
    .digest('hex')
    .slice(0, 12)
  const parts = [name, pathHash]

  if (options.width) parts.push(`w${options.width}`)
  if (options.height) parts.push(`h${options.height}`)
  if (options.quality && options.quality !== DEFAULT_QUALITY) parts.push(`q${options.quality}`)

  const ext = options.format && options.format !== 'original'
    ? `.${options.format === 'jpeg' ? 'jpg' : options.format}`
    : extname(sourcePath)

  return parts.join('-') + ext
}

/**
 * Get the MIME type for a format.
 */
function getMimeType(format: string): string {
  const mimeMap: Record<string, string> = {
    webp: 'image/webp',
    avif: 'image/avif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    svg: 'image/svg+xml',
  }
  return mimeMap[format] || 'application/octet-stream'
}

// =============================================================================
// CORE PROCESSING
// =============================================================================

/**
 * Process an image with the given options.
 * Returns the processed buffer and metadata, or null if processing fails.
 */
async function processImageBuffer(
  sourceBuffer: Buffer,
  options: ImageOptions
): Promise<ProcessedImage | null> {
  const sharp = await getSharp()
  if (!sharp) return null

  try {
    let pipeline = sharp(sourceBuffer)

    // Resize
    if (options.width || options.height) {
      pipeline = pipeline.resize({
        width: options.width ? Math.min(options.width, MAX_WIDTH) : undefined,
        height: options.height ? Math.min(options.height, MAX_HEIGHT) : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      })
    }

    // Format conversion
    const quality = options.quality || DEFAULT_QUALITY
    const format = options.format || 'original'

    if (format === 'webp') {
      pipeline = pipeline.webp({ quality })
    } else if (format === 'avif') {
      pipeline = pipeline.avif({ quality })
    } else if (format === 'jpeg' || format === 'jpg') {
      pipeline = pipeline.jpeg({ quality })
    } else if (format === 'png') {
      pipeline = pipeline.png()
    }
    // 'original' — no format conversion

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })

    const outputFormat = format === 'original' ? info.format : format
    return {
      buffer: data,
      mimeType: getMimeType(outputFormat),
      width: info.width,
      height: info.height,
    }
  } catch (error) {
    logger.warn('Image processing failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Check if a file is a processable image based on extension.
 */
export function isProcessableImage(filename: string): boolean {
  const ext = extname(filename).toLowerCase()
  return IMAGE_EXTENSIONS.includes(ext) && ext !== '.svg' && ext !== '.gif'
}

/**
 * Parse image processing options from URL query parameters.
 */
export function parseImageOptions(query: Record<string, unknown>): ImageOptions | null {
  const w = query.w || query.width
  const h = query.h || query.height
  const f = query.f || query.format
  const q = query.q || query.quality

  // No processing params — serve original
  if (!w && !h && !f && !q) return null

  const options: ImageOptions = {}

  if (w) {
    const width = parseInt(String(w), 10)
    if (width > 0) options.width = snapUp(width, SIZE_STEPS)
  }

  if (h) {
    const height = parseInt(String(h), 10)
    if (height > 0) options.height = Math.min(snapUp(height, SIZE_STEPS), MAX_HEIGHT)
  }

  if (f) {
    const format = String(f).toLowerCase()
    if (SUPPORTED_FORMATS.includes(format as typeof SUPPORTED_FORMATS[number])) {
      options.format = format as ImageOptions['format']
    }
  }

  if (q) {
    const quality = parseInt(String(q), 10)
    if (quality >= 1 && quality <= 100) options.quality = snapUp(quality, QUALITY_STEPS)
  }

  return Object.keys(options).length > 0 ? options : null
}

/**
 * Get a processed image, using disk cache when available.
 * Falls back to original on any failure (constraint C-MEDIA-PROGRESSIVE-012).
 * 
 * @param sourcePath - Absolute path to the original image
 * @param cacheDir - Directory for disk cache (f0Config().imageCacheDir)
 * @param options - Processing options (width, format, quality)
 * @returns Processed image buffer and mime type
 */
// Used only when the cache directory cannot be written (read-only
// filesystem, wrong permissions), so variants are not re-encoded per request.
const MEMORY_CACHE_MAX_BYTES = 32 * 1024 * 1024
const memoryCache = new Map<string, Buffer>()
let memoryCacheBytes = 0
let diskWriteWarned = false

function rememberInMemory(key: string, buffer: Buffer): void {
  if (buffer.length > MEMORY_CACHE_MAX_BYTES / 4) return
  const existing = memoryCache.get(key)
  if (existing) {
    memoryCacheBytes -= existing.length
    memoryCache.delete(key)
  }
  memoryCache.set(key, buffer)
  memoryCacheBytes += buffer.length
  while (memoryCacheBytes > MEMORY_CACHE_MAX_BYTES) {
    const oldest = memoryCache.keys().next().value
    if (oldest === undefined) break
    memoryCacheBytes -= memoryCache.get(oldest)!.length
    memoryCache.delete(oldest)
  }
}

export async function getProcessedImage(
  sourcePath: string,
  cacheDir: string,
  options: ImageOptions
): Promise<ProcessedImage | null> {
  const sourceStats = await stat(sourcePath)
  const cacheKey = getCacheKey(sourcePath, sourceStats, options)
  const cachePath = join(cacheDir, cacheKey)
  const mimeType = getMimeType(extname(cacheKey).toLowerCase().replace('.', ''))

  // Check the memory fallback, then the disk cache
  const remembered = memoryCache.get(cacheKey)
  if (remembered) {
    memoryCache.delete(cacheKey)
    memoryCache.set(cacheKey, remembered)
    return { buffer: remembered, mimeType }
  }
  try {
    return { buffer: await readFile(cachePath), mimeType }
  } catch {
    // Cache miss or read error — continue to process
  }

  // Process the image
  const sourceBuffer = await readFile(sourcePath)
  const result = await processImageBuffer(sourceBuffer, options)

  if (!result) return null

  try {
    // Write then rename, so a concurrent request never reads a partial file
    await mkdir(dirname(cachePath), { recursive: true })
    const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`
    try {
      await writeFile(tempPath, result.buffer)
      await rename(tempPath, cachePath)
    } catch (error) {
      await unlink(tempPath).catch(() => {})
      throw error
    }
  } catch (error) {
    if (!diskWriteWarned) {
      diskWriteWarned = true
      logger.warn('Image cache directory is not writable; keeping variants in memory (set NUXT_IMAGE_CACHE_DIR)', {
        path: cacheDir,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    rememberInMemory(cacheKey, result.buffer)
  }

  return result
}
