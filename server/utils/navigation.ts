/**
 * =============================================================================
 * F0 - NAVIGATION & FILESYSTEM SCANNER
 * =============================================================================
 * 
 * This module handles navigation structure generation from two sources:
 * 1. nav.md - Defines top-level navigation tabs
 * 2. Filesystem - Auto-generates sidebar tree within each section
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-ARCH-FILESYSTEM-SOT-001: Filesystem is the single source of truth
 * - C-ARCH-NAV-CANONICAL-002: Navigation derived from nav.md + filesystem
 * 
 * NAVIGATION STRUCTURE:
 * Top-level (from nav.md):
 *   - [Home](/)
 *   - [Guides](/guides)
 *   - [API Reference](/api)
 * 
 * Within sections (auto-generated from filesystem):
 *   /content/guides/
 *   ├── 01-getting-started.md  → "Getting Started" (order: 1)
 *   ├── 02-configuration.md    → "Configuration" (order: 2)
 *   └── authentication/        → Collapsible folder
 *       ├── overview.md
 *       └── oauth.md
 * 
 * ORDERING LOGIC:
 * 1. Frontmatter `order` field (highest priority)
 * 2. Numeric prefix in filename (e.g., "01-", "02-")
 * 3. Alphabetical by title
 * 
 * CACHING:
 * Navigation is cached in memory and invalidated when content changes
 * (via webhook or admin upload)
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, extname, relative } from 'path'
import { parseMarkdown, isMarkdownFile, isJsonSpecFile } from './markdown'
import { logger } from './logger'
import { isConfinedEntry, isConfinedPath, resolveUrlDir, sortedEntries } from './paths'
import { MARKDOWN_EXTENSIONS, PAGE_EXTENSIONS, firstHeading, stripOrderPrefix, stripPageExtension, readFrontmatter, stringField, titleFromFileName, urlNamesFor } from './content-core'
import { hiddenFromListings } from './drafts'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Top-level navigation item (from nav.md)
 */
export interface TopNavItem {
  title: string
  path: string
  isExternal: boolean
}

/**
 * Sidebar navigation item (recursive tree)
 */
export interface SidebarItem {
  title: string
  path: string
  type: 'file' | 'folder'
  order: number
  children?: SidebarItem[]
  isActive?: boolean  // Set by frontend based on current route
}

/**
 * Complete navigation structure
 */
export interface Navigation {
  topNav: TopNavItem[]
  sidebar: Map<string, SidebarItem[]>  // Keyed by top-level section path
}

/**
 * Content file metadata (for listings)
 */
export interface ContentMeta {
  slug: string
  title: string
  description?: string
  path: string
  order: number
  type: 'markdown' | 'openapi' | 'postman'
  lastModified: Date
}

// =============================================================================
// MTIME-BASED NAVIGATION CACHE (Phase 1.3)
// =============================================================================

/**
 * Cache for navigation data.
 * Invalidation uses nav.md mtime + directory structure hash.
 * No TTL — content changes when files change, period.
 */
let navigationCache: Navigation | null = null
let contentMetaCache: Map<string, ContentMeta> = new Map()
let cachedNavMtime: number = 0          // mtime of nav.md
let cachedDirStructureHash: string = '' // Hash of directory listing

/**
 * Compute a lightweight hash of the directory structure.
 * Only checks directory names + file names + mtimes at top 2 levels.
 * This is much cheaper than a full recursive scan.
 */
async function computeDirStructureHash(contentDir: string): Promise<string> {
  const parts: string[] = []
  try {
    const entries = await readdir(contentDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'assets' || entry.name === 'images') continue
      const entryPath = join(contentDir, entry.name)
      try {
        const s = await stat(entryPath)
        parts.push(`${entry.name}:${s.mtimeMs}:${entry.isDirectory() ? 'd' : 'f'}`)
        // One level deeper for directories
        if (entry.isDirectory()) {
          const subEntries = await readdir(entryPath, { withFileTypes: true })
          for (const sub of subEntries) {
            if (sub.name.startsWith('.') || sub.name.startsWith('_')) continue
            try {
              const ss = await stat(join(entryPath, sub.name))
              parts.push(`${entry.name}/${sub.name}:${ss.mtimeMs}`)
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
  return parts.sort().join('|')
}

/**
 * Check if navigation cache is still valid using mtime comparison.
 */
async function isNavCacheValid(contentDir: string): Promise<boolean> {
  if (!navigationCache) return false

  // Check nav.md mtime
  try {
    const navStats = await stat(join(contentDir, 'nav.md'))
    if (navStats.mtimeMs !== cachedNavMtime) return false
  } catch {
    // nav.md doesn't exist — if we cached with mtime 0, still valid
    if (cachedNavMtime !== 0) return false
  }

  // Check directory structure hash
  const currentHash = await computeDirStructureHash(contentDir)
  return currentHash === cachedDirStructureHash
}

/**
 * Invalidate the navigation cache.
 * Call this after content changes (webhook, upload).
 */
export function invalidateNavigationCache(): void {
  navigationCache = null
  contentMetaCache.clear()
  cachedNavMtime = 0
  cachedDirStructureHash = ''
  logger.info('Navigation cache invalidated')
}

// =============================================================================
// NAV.MD PARSER
// =============================================================================

/**
 * Parse nav.md to extract top-level navigation
 * 
 * Expected format:
 * - [Home](/)
 * - [Guides](/guides)
 * - [External](https://example.com)
 * 
 * @param contentDir - Path to content directory
 * @returns Array of top navigation items
 */
async function parseNavMd(contentDir: string): Promise<TopNavItem[]> {
  const navPath = join(contentDir, 'nav.md')
  
  try {
    const content = await readFile(navPath, 'utf-8')
    const items: TopNavItem[] = []
    
    // Match markdown links: - [Title](/path) or - [Title](https://...)
    const linkRegex = /^-\s*\[([^\]]+)\]\(([^)]+)\)\s*$/gm
    let match
    
    while ((match = linkRegex.exec(content)) !== null) {
      const [, title, path] = match
      const isExternal = path.startsWith('http://') || path.startsWith('https://')
      
      items.push({
        title: title.trim(),
        path: path.trim(),
        isExternal,
      })
    }
    
    return items
  } catch (error) {
    // If nav.md doesn't exist, return empty array
    // The system will still work with auto-generated navigation
    logger.warn('nav.md not found, using filesystem-only navigation')
    return []
  }
}

// =============================================================================
// FILESYSTEM SCANNER
// =============================================================================

/**
 * Extract order from filename prefix (e.g., "01-getting-started.md" → 1)
 */
function extractOrderFromFilename(filename: string): number | null {
  const match = filename.match(/^(\d+)-/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Clean filename for display (remove order prefix and extension)
 * "01-getting-started.md" → "Getting Started"
 */
function cleanFilename(filename: string): string {
  return titleFromFileName(filename)
}

/**
 * Ensure path always starts with /
 */
function ensureLeadingSlash(path: string): string {
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * Get title from markdown file (frontmatter > h1 > filename)
 */
async function getTitleFromMarkdown(filePath: string): Promise<{ title: string; order: number | null; hidden?: boolean }> {
  try {
    const doc = readFrontmatter(await readFile(filePath, 'utf-8'))
    
    // With frontmatter, the sidebar uses its title or else the file name
    // (a long H1 does not become the sidebar label)
    if (doc.hasFrontmatter) {
      return {
        title: stringField(doc.data, 'title') ?? cleanFilename(filePath),
        order: typeof doc.data.order === 'number' ? doc.data.order : null,
        hidden: hiddenFromListings(doc.data, 'site'),
      }
    }
    
    // Without frontmatter: first H1 (outside code fences), then the file name
    return { title: firstHeading(doc.body) ?? cleanFilename(filePath), order: null }
  } catch {
    return { title: cleanFilename(filePath), order: null }
  }
}

/**
 * Get title from JSON spec file (OpenAPI title or Postman name)
 */
async function getTitleFromJsonSpec(filePath: string): Promise<{ title: string; order: number | null }> {
  try {
    const content = await readFile(filePath, 'utf-8')
    const json = JSON.parse(content)
    
    // OpenAPI spec
    if (json.openapi || json.swagger) {
      return {
        title: json.info?.title || cleanFilename(filePath),
        order: null,
      }
    }
    
    // Postman collection
    if (json.info?.schema?.includes('schema.getpostman.com')) {
      return {
        title: json.info?.name || cleanFilename(filePath),
        order: null,
      }
    }
    
    return { title: cleanFilename(filePath), order: null }
  } catch {
    return { title: cleanFilename(filePath), order: null }
  }
}

/**
 * Recursively scan a directory to build sidebar tree
 * 
 * @param dirPath - Directory to scan
 * @param basePath - Base URL path for this directory
 * @param contentDir - Root content directory (for relative path calculation)
 */
async function scanDirectory(
  dirPath: string,
  basePath: string,
  contentDir: string
): Promise<SidebarItem[]> {
  const items: SidebarItem[] = []
  
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name)
      // Build URL path - handle root path case to avoid double slashes
      // Strip both numeric prefixes (01-) and date prefixes (2026-02-11-)
      // URL name: order prefix and page extension removed (same rule as
      // fileToUrlPath, so .mdx and .markdown pages link correctly)
      const cleanName = stripOrderPrefix(stripPageExtension(entry.name))
      
      // Construct path, avoiding double slashes when basePath is "/"
      let urlPath: string
      if (!basePath || basePath === '/') {
        urlPath = `/${cleanName}`
      } else {
        urlPath = `${basePath}/${cleanName}`
      }
      
      // Skip hidden files and special files
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      
      // Skip nav.md (it's parsed separately)
      if (entry.name === 'nav.md') continue
      
      // Skip home.md (it's rendered at root)
      if (entry.name === 'home.md') continue
      
      // Skip index.md files (they're section landing pages, not sidebar items)
      if (entry.name === 'index.md') continue
      
      // Skip assets/images folders
      if (entry.name === 'assets' || entry.name === 'images') continue
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectory
        const children = await scanDirectory(entryPath, urlPath, contentDir)
        
        // Only include folder if it has children
        if (children.length > 0) {
          const filenameOrder = extractOrderFromFilename(entry.name)
          items.push({
            title: cleanFilename(entry.name),
            path: urlPath,
            type: 'folder',
            order: filenameOrder ?? 999,
            children,
          })
        }
      } else if (isMarkdownFile(entry.name) && await isConfinedEntry(dirPath, entry, contentDir)) {
        // Parse markdown file for metadata
        const { title, order: frontmatterOrder, hidden } = await getTitleFromMarkdown(entryPath)
        if (hidden) continue // drafts are reachable by URL but not listed
        const filenameOrder = extractOrderFromFilename(entry.name)
        
        items.push({
          title,
          path: urlPath,
          type: 'file',
          order: frontmatterOrder ?? filenameOrder ?? 999,
        })
      } else if (isJsonSpecFile(entry.name) && await isConfinedEntry(dirPath, entry, contentDir)) {
        // Parse JSON spec for metadata
        logger.debug('Found JSON spec', { name: entry.name, path: entryPath })
        const { title } = await getTitleFromJsonSpec(entryPath)
        const filenameOrder = extractOrderFromFilename(entry.name)
        
        logger.debug('JSON spec metadata', { title, urlPath })
        
        items.push({
          title,
          path: urlPath,
          type: 'file',
          order: filenameOrder ?? 999,
        })
      }
    }
    
    // Sort by order, then alphabetically by title
    items.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      return a.title.localeCompare(b.title)
    })
    
    return items
  } catch (error) {
    logger.error('Error scanning directory', { path: dirPath, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

// =============================================================================
// MAIN NAVIGATION BUILDER
// =============================================================================

/**
 * Build complete navigation structure
 * 
 * @param contentDir - Path to content directory
 * @returns Navigation object with topNav and sidebar
 */
export async function buildNavigation(contentDir: string): Promise<Navigation> {
  // Return cached if available and valid (mtime-based)
  if (await isNavCacheValid(contentDir)) {
    return navigationCache!
  }
  
  logger.info('Building navigation', { contentDir })
  
  // Parse top-level navigation from nav.md
  const topNav = await parseNavMd(contentDir)
  
  // Build sidebar for each top-level section
  const sidebar = new Map<string, SidebarItem[]>()
  
  // If topNav is empty, scan root directory
  if (topNav.length === 0) {
    const rootItems = await scanDirectory(contentDir, '', contentDir)
    sidebar.set('/', rootItems)
  } else {
    // Build sidebar for each section
    for (const navItem of topNav) {
      if (navItem.isExternal) continue
      
      // Convert URL path to a folder; [Reference](/reference) finds 02-reference/
      const sectionPath = navItem.path === '/'
        ? contentDir
        : await resolveUrlDir(contentDir, navItem.path.split('/').filter(Boolean))
      
      try {
        if (sectionPath && (await stat(sectionPath)).isDirectory()) {
          const sectionItems = await scanDirectory(sectionPath, navItem.path, contentDir)
          sidebar.set(navItem.path, sectionItems)
        } else {
          sidebar.set(navItem.path, [])
        }
      } catch {
        // Directory doesn't exist, create empty sidebar
        sidebar.set(navItem.path, [])
      }
    }
  }
  
  // Cache the result with mtime data
  navigationCache = { topNav, sidebar }
  
  // Store nav.md mtime for cache invalidation
  try {
    const navStats = await stat(join(contentDir, 'nav.md'))
    cachedNavMtime = navStats.mtimeMs
  } catch {
    cachedNavMtime = 0
  }
  cachedDirStructureHash = await computeDirStructureHash(contentDir)
  
  return navigationCache
}

/**
 * Get sidebar items for a specific section
 */
export async function getSidebarForSection(
  contentDir: string,
  sectionPath: string
): Promise<SidebarItem[]> {
  const nav = await buildNavigation(contentDir)
  
  // Find the matching section
  // If exact match exists, use it
  if (nav.sidebar.has(sectionPath)) {
    return nav.sidebar.get(sectionPath) || []
  }
  
  // Otherwise, find the parent section
  for (const [key, items] of nav.sidebar.entries()) {
    if (sectionPath.startsWith(key) && key !== '/') {
      return items
    }
  }
  
  // Fallback to root
  return nav.sidebar.get('/') || []
}

// =============================================================================
// CONTENT METADATA
// =============================================================================

/**
 * Get metadata for a content file
 */
/**
 * Files a URL slug may refer to, in priority order. Folder segments match a
 * literal folder first, then a numbered one (/reference → 02-reference/).
 * In the last segment, a prefixed file (01-intro.md, 2026-02-11-hello.md)
 * comes first, then the literal name (.md, .markdown, .mdx), the folder's
 * index.md, and an API spec (.json): the order resolution has always used.
 */
async function candidatePaths(contentDir: string, slug: string): Promise<string[]> {
  const segments = slug.split('/').filter(Boolean)
  const name = segments.pop()
  if (!name) return []

  const parent = await resolveUrlDir(contentDir, segments)
  if (!parent) return []

  const prefixed: string[] = []
  for (const entry of await sortedEntries(parent)) {
    const ext = extname(entry).toLowerCase()
    if (!(PAGE_EXTENSIONS as readonly string[]).includes(ext)) continue
    const base = entry.slice(0, -ext.length)
    if (base !== name && urlNamesFor(base).includes(name)) prefixed.unshift(join(parent, entry))
  }

  const literal = MARKDOWN_EXTENSIONS.map(ext => join(parent, `${name}${ext}`))
  const folder = await resolveUrlDir(parent, [name])
  const index = folder ? [join(folder, 'index.md')] : []

  return [...prefixed, ...literal, ...index, join(parent, `${name}.json`)]
}

export async function getContentMeta(
  contentDir: string,
  slug: string
): Promise<ContentMeta | null> {
  const cacheKey = slug
  
  // Check cache, but only trust an entry whose file is unchanged: a renamed
  // or deleted file must not turn into a 500 until the next webhook
  const cachedMeta = contentMetaCache.get(cacheKey)
  if (cachedMeta) {
    const current = await stat(cachedMeta.path).catch(() => null)
    if (current?.isFile() && current.mtimeMs === cachedMeta.lastModified.getTime()) {
      return cachedMeta
    }
    contentMetaCache.delete(cacheKey)
  }
  
  const possiblePaths = await candidatePaths(contentDir, slug)
  
  // Try each possible path
  for (const filePath of possiblePaths) {
    try {
      const stats = await stat(filePath)
      if (!stats.isFile()) continue
      // Symlinks must not lead outside the content directory
      if (!(await isConfinedPath(filePath, contentDir))) continue
      
      const ext = extname(filePath).toLowerCase()
      let title: string
      let description: string | undefined
      let order: number
      let type: 'markdown' | 'openapi' | 'postman'
      
      if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) {
        const { title: mdTitle, order: mdOrder } = await getTitleFromMarkdown(filePath)
        title = mdTitle
        order = mdOrder ?? 999
        type = 'markdown'
      } else if (ext === '.json') {
        const { title: jsonTitle } = await getTitleFromJsonSpec(filePath)
        title = jsonTitle
        order = 999
        
        // Determine if OpenAPI or Postman
        const content = await readFile(filePath, 'utf-8')
        const json = JSON.parse(content)
        type = (json.openapi || json.swagger) ? 'openapi' : 'postman'
      } else {
        continue
      }
      
      const meta: ContentMeta = {
        slug,
        title,
        description,
        path: filePath,
        order,
        type,
        lastModified: stats.mtime,
      }
      
      // Cache and return
      contentMetaCache.set(cacheKey, meta)
      return meta
    } catch {
      // File doesn't exist, try next
      continue
    }
  }
  
  return null
}

/**
 * Resolve a URL slug to a filesystem path
 * Handles numeric prefixes and index files
 */
export async function resolveContentPath(
  contentDir: string,
  slug: string
): Promise<string | null> {
  const meta = await getContentMeta(contentDir, slug)
  return meta?.path || null
}
