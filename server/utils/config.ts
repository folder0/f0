/**
 * =============================================================================
 * F0 - DIRECTORY CONFIGURATION RESOLVER
 * =============================================================================
 * 
 * Reads and caches `_config.md` files that declare layout type and settings
 * for content directories. Supports per-directory configuration with no
 * cascading — each directory manages its own layout.
 * 
 * RESOLUTION PRIORITY:
 * 1. _config.md in the directory → use its layout value
 * 2. F0_MODE=blog and path is root → treat as blog
 * 3. Default → docs layout
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-ARCH-FILESYSTEM-SOT-001: Config lives in the content filesystem
 * - C-OPS-ZERO-CONFIG-DEFAULT-008: Default is docs, no config needed
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { logger } from './logger'
import { f0Config } from './f0-config'
import { readFrontmatter, resolveAssetUrl as resolveContentAssetUrl } from './content-core'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface DirectoryConfig {
  layout: 'docs' | 'blog'
  title: string
  description: string
  postsPerPage: number
  defaultAuthor: string
  showToc: boolean
  dateFormat: 'long' | 'short' | 'relative'
  /** Full-bleed hero background image (URL or content-relative path) */
  heroImage: string
  /** Hero subtitle/tagline shown below the title */
  heroSubtitle: string
}

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_DOCS_CONFIG: DirectoryConfig = {
  layout: 'docs',
  title: '',
  description: '',
  postsPerPage: 10,
  defaultAuthor: '',
  showToc: true,
  dateFormat: 'long',
  heroImage: '',
  heroSubtitle: '',
}

const DEFAULT_BLOG_CONFIG: DirectoryConfig = {
  layout: 'blog',
  title: 'Blog',
  description: '',
  postsPerPage: 10,
  defaultAuthor: '',
  showToc: false,
  dateFormat: 'long',
  heroImage: '',
  heroSubtitle: '',
}

// =============================================================================
// CACHE
// =============================================================================

const configCache = new Map<string, DirectoryConfig>()
let cacheTimestamp = 0
const CACHE_TTL = 5000 // 5 seconds in dev

function isCacheValid(): boolean {
  if (process.env.NODE_ENV === 'production') return true
  return (Date.now() - cacheTimestamp) < CACHE_TTL
}

/**
 * Invalidate the config cache (call after content changes)
 */
export function invalidateConfigCache(): void {
  configCache.clear()
  cacheTimestamp = 0
}

// =============================================================================
// FRONTMATTER EXTRACTION (lightweight, no full markdown parse)
// =============================================================================

function extractConfigFrontmatter(content: string): Record<string, unknown> {
  const doc = readFrontmatter(content)
  if (doc.error) {
    logger.warn('Failed to parse _config.md frontmatter', { error: doc.error })
  }
  return doc.data
}

// =============================================================================
// ASSET URL RESOLUTION
// =============================================================================

/**
 * Resolve an asset path (./assets/images/hero.jpg) to its URL, with the same
 * rule as images in Markdown (see content-core resolveAssetUrl).
 */
function resolveAssetUrl(path: string): string {
  return path ? resolveContentAssetUrl(path) : ''
}

// =============================================================================
// MAIN RESOLVER
// =============================================================================

/**
 * Parse a _config.md file into a DirectoryConfig
 */
function parseConfigFile(configPath: string): DirectoryConfig {
  try {
    const content = readFileSync(configPath, 'utf-8')
    const fm = extractConfigFrontmatter(content)
    
    const layout = fm.layout === 'blog' ? 'blog' : 'docs'
    const defaults = layout === 'blog' ? DEFAULT_BLOG_CONFIG : DEFAULT_DOCS_CONFIG
    
    return {
      layout,
      title: (fm.title as string) || defaults.title,
      description: (fm.description as string) || defaults.description,
      postsPerPage: typeof fm.posts_per_page === 'number' ? fm.posts_per_page : defaults.postsPerPage,
      defaultAuthor: (fm.default_author as string) || defaults.defaultAuthor,
      showToc: typeof fm.show_toc === 'boolean' ? fm.show_toc : defaults.showToc,
      dateFormat: (['long', 'short', 'relative'].includes(fm.date_format as string)
        ? fm.date_format as 'long' | 'short' | 'relative'
        : defaults.dateFormat),
      heroImage: resolveAssetUrl((fm.hero_image as string) || ''),
      heroSubtitle: (fm.hero_subtitle as string) || defaults.heroSubtitle,
    }
  } catch (error) {
    logger.warn('Error reading config', { path: configPath, error: error instanceof Error ? error.message : String(error) })
    return { ...DEFAULT_DOCS_CONFIG }
  }
}

/**
 * Default configuration for a directory that has no _config.md.
 * Returned uncached for paths that do not exist, so unauthenticated
 * ?path= values cannot grow the config cache.
 */
export function defaultDirectoryConfig(): DirectoryConfig {
  return { ...DEFAULT_DOCS_CONFIG }
}

/**
 * Resolve the configuration for a content directory.
 *
 * @param contentDir - Root content directory path
 * @param dirPath - Relative directory path within content (e.g., 'blog', '' for root)
 * @returns DirectoryConfig for the directory
 */
export function resolveDirectoryConfig(contentDir: string, dirPath: string): DirectoryConfig {
  // Normalize dirPath
  const normalizedDir = dirPath.replace(/^\//, '').replace(/\/$/, '') || ''
  const cacheKey = `${contentDir}:${normalizedDir}`
  
  // Check cache
  if (configCache.has(cacheKey) && isCacheValid()) {
    return configCache.get(cacheKey)!
  }
  
  // 1. Check for _config.md in this directory
  const fullDirPath = normalizedDir ? join(contentDir, normalizedDir) : contentDir
  const configPath = join(fullDirPath, '_config.md')
  
  if (existsSync(configPath)) {
    const config = parseConfigFile(configPath)
    configCache.set(cacheKey, config)
    cacheTimestamp = Date.now()
    return config
  }
  
  // 2. If this is the root directory and F0_MODE=blog, apply blog defaults
  if (normalizedDir === '' && f0Config().f0Mode === 'blog') {
    const config: DirectoryConfig = {
      ...DEFAULT_BLOG_CONFIG,
      title: process.env.NUXT_PUBLIC_SITE_NAME || 'Blog',
      description: process.env.NUXT_PUBLIC_SITE_DESCRIPTION || '',
    }
    configCache.set(cacheKey, config)
    cacheTimestamp = Date.now()
    return config
  }
  
  // 3. Default: docs layout
  const config = { ...DEFAULT_DOCS_CONFIG }
  configCache.set(cacheKey, config)
  cacheTimestamp = Date.now()
  return config
}

/**
 * Determine the layout for a given content path by checking its
 * nearest directory's _config.md
 * 
 * @param contentDir - Root content directory path
 * @param contentPath - URL path (e.g., '/blog/my-post' or 'blog/my-post')
 * @returns 'docs' or 'blog'
 */
export function resolveLayoutForPath(contentDir: string, contentPath: string): 'docs' | 'blog' {
  // Normalize: strip leading slash, get directory portion
  const normalized = contentPath.replace(/^\//, '')
  
  // Get the first path segment as the directory
  const firstSegment = normalized.split('/')[0] || ''
  
  // Check if this segment has a _config.md
  const config = resolveDirectoryConfig(contentDir, firstSegment)
  return config.layout
}

/**
 * Get the full directory config for a content path
 */
export function getConfigForPath(contentDir: string, contentPath: string): DirectoryConfig {
  const normalized = contentPath.replace(/^\//, '')
  const firstSegment = normalized.split('/')[0] || ''
  return resolveDirectoryConfig(contentDir, firstSegment)
}
