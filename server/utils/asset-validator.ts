/**
 * =============================================================================
 * F0 - ASSET VALIDATION
 * =============================================================================
 * 
 * Validates that image and asset references in Markdown content actually exist
 * on the filesystem. Reports missing assets via structured logging.
 * 
 * Used in two contexts:
 * 1. During content cache build (runtime) — logs warnings
 * 2. During CLI validation (pre-deploy) — returns structured results
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-MEDIA-PROGRESSIVE-012: Missing assets produce warnings, never errors.
 *   Pages still render — broken images get a styled placeholder.
 */

import { existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { logger } from './logger'

// =============================================================================
// TYPES
// =============================================================================

export interface AssetReference {
  /** The src attribute value as written in Markdown */
  src: string
  /** The resolved filesystem path */
  resolvedPath: string
  /** Whether the file exists on disk */
  exists: boolean
  /** The Markdown file that contains this reference */
  referencedIn: string
}

export interface AssetValidationResult {
  total: number
  valid: number
  missing: AssetReference[]
}

// =============================================================================
// IMAGE REFERENCE EXTRACTION
// =============================================================================

/**
 * Extract all image references from raw Markdown content.
 * Supports standard Markdown images and HTML img tags.
 */
export function extractImageReferences(markdown: string): string[] {
  const refs: string[] = []

  // Standard Markdown: ![alt](src)
  const mdImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g
  let match
  while ((match = mdImageRegex.exec(markdown)) !== null) {
    const src = match[1].split(/\s+/)[0] // Strip title after space
    if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:')) {
      refs.push(src)
    }
  }

  // HTML img tags: <img src="...">
  const htmlImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  while ((match = htmlImgRegex.exec(markdown)) !== null) {
    const src = match[1]
    if (src && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('data:') && !src.startsWith('/api/')) {
      refs.push(src)
    }
  }

  // Deduplicate
  return [...new Set(refs)]
}

// =============================================================================
// PATH RESOLUTION
// =============================================================================

/**
 * Resolve a relative image path to an absolute filesystem path.
 * 
 * Resolution rules:
 * - `./assets/images/x.png` → `contentDir/assets/images/x.png`
 * - `assets/images/x.png` → `contentDir/assets/images/x.png`
 * - `../shared/x.png` → relative to the markdown file's directory
 * - `/assets/images/x.png` → `contentDir/assets/images/x.png`
 */
export function resolveAssetPath(
  contentDir: string,
  markdownFilePath: string,
  imageSrc: string
): string {
  // Absolute content-relative path
  if (imageSrc.startsWith('/')) {
    return join(contentDir, imageSrc)
  }

  // Relative path starting with ./assets/ or assets/
  if (imageSrc.startsWith('./assets/') || imageSrc.startsWith('assets/')) {
    return join(contentDir, imageSrc.replace(/^\.\//, ''))
  }

  // Other relative paths — resolve from the markdown file's directory
  const mdDir = dirname(resolve(markdownFilePath))
  return resolve(mdDir, imageSrc)
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate all image references in a markdown file.
 * Returns structured results for both runtime logging and CLI reporting.
 */
export function validateAssets(
  markdown: string,
  markdownFilePath: string,
  contentDir: string
): AssetValidationResult {
  const refs = extractImageReferences(markdown)
  const results: AssetReference[] = []
  const missing: AssetReference[] = []

  for (const src of refs) {
    const resolvedPath = resolveAssetPath(contentDir, markdownFilePath, src)
    const exists = existsSync(resolvedPath)

    const ref: AssetReference = {
      src,
      resolvedPath,
      exists,
      referencedIn: markdownFilePath,
    }

    results.push(ref)

    if (!exists) {
      missing.push(ref)
    }
  }

  return {
    total: results.length,
    valid: results.length - missing.length,
    missing,
  }
}

/**
 * Validate assets and log warnings for missing references.
 * Called during content cache build.
 */
export function validateAndLogAssets(
  markdown: string,
  markdownFilePath: string,
  contentDir: string
): void {
  const result = validateAssets(markdown, markdownFilePath, contentDir)

  for (const ref of result.missing) {
    logger.warn('Missing image reference', {
      image: ref.src,
      referencedIn: ref.referencedIn,
      resolvedTo: ref.resolvedPath,
    })
  }
}
