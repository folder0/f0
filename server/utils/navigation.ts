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
import { join, basename, extname, relative } from 'path'
import { parseMarkdown, isMarkdownFile, isJsonSpecFile } from './markdown'
import yaml from 'yaml'

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
// NAVIGATION CACHE
// =============================================================================

/**
 * Cache for navigation data
 * Invalidate by calling invalidateNavigationCache()
 */
let navigationCache: Navigation | null = null
let contentMetaCache: Map<string, ContentMeta> = new Map()

/**
 * Invalidate the navigation cache
 * Call this after content changes (webhook, upload)
 */
export function invalidateNavigationCache(): void {
  navigationCache = null
  contentMetaCache.clear()
  console.log('[Navigation] Cache invalidated')
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
    console.warn('[Navigation] nav.md not found, using filesystem-only navigation')
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
  let name = basename(filename, extname(filename))
  
  // Remove numeric prefix
  name = name.replace(/^\d+-/, '')
  
  // Convert kebab-case to Title Case
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
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
async function getTitleFromMarkdown(filePath: string): Promise<{ title: string; order: number | null }> {
  try {
    const content = await readFile(filePath, 'utf-8')
    
    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/)
    if (frontmatterMatch) {
      try {
        const frontmatter = yaml.parse(frontmatterMatch[1])
        return {
          title: frontmatter.title || cleanFilename(filePath),
          order: typeof frontmatter.order === 'number' ? frontmatter.order : null,
        }
      } catch {
        // Frontmatter parse failed, continue to H1 extraction
      }
    }
    
    // Extract first H1
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) {
      return { title: h1Match[1].trim(), order: null }
    }
    
    // Fallback to filename
    return { title: cleanFilename(filePath), order: null }
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
      const cleanName = entry.name.replace(/^\d+-/, '').replace(/\.(md|json)$/, '')
      
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
      } else if (isMarkdownFile(entry.name)) {
        // Parse markdown file for metadata
        const { title, order: frontmatterOrder } = await getTitleFromMarkdown(entryPath)
        const filenameOrder = extractOrderFromFilename(entry.name)
        
        items.push({
          title,
          path: urlPath,
          type: 'file',
          order: frontmatterOrder ?? filenameOrder ?? 999,
        })
      } else if (isJsonSpecFile(entry.name)) {
        // Parse JSON spec for metadata
        const { title } = await getTitleFromJsonSpec(entryPath)
        const filenameOrder = extractOrderFromFilename(entry.name)
        
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
    console.error(`[Navigation] Error scanning directory ${dirPath}:`, error)
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
  // Return cached if available
  if (navigationCache) {
    return navigationCache
  }
  
  console.log('[Navigation] Building navigation from', contentDir)
  
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
      
      // Convert URL path to filesystem path
      const sectionPath = navItem.path === '/' 
        ? contentDir 
        : join(contentDir, navItem.path.replace(/^\//, ''))
      
      try {
        const stats = await stat(sectionPath)
        if (stats.isDirectory()) {
          const sectionItems = await scanDirectory(sectionPath, navItem.path, contentDir)
          sidebar.set(navItem.path, sectionItems)
        }
      } catch {
        // Directory doesn't exist, create empty sidebar
        sidebar.set(navItem.path, [])
      }
    }
  }
  
  // Cache the result
  navigationCache = { topNav, sidebar }
  
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
export async function getContentMeta(
  contentDir: string,
  slug: string
): Promise<ContentMeta | null> {
  const cacheKey = slug
  
  // Check cache
  if (contentMetaCache.has(cacheKey)) {
    return contentMetaCache.get(cacheKey)!
  }
  
  // Possible file paths to check
  const possiblePaths = [
    join(contentDir, `${slug}.md`),
    join(contentDir, `${slug}/index.md`),
    join(contentDir, `${slug}.json`),
  ]
  
  // Also check with numeric prefixes (01-, 02-, etc.)
  const slugParts = slug.split('/')
  const fileName = slugParts.pop()!
  const dirPath = join(contentDir, ...slugParts)
  
  try {
    const entries = await readdir(dirPath)
    for (const entry of entries) {
      // Match files like "01-getting-started.md" for slug "getting-started"
      if (entry.match(new RegExp(`^\\d+-${fileName}\\.(md|json)$`))) {
        possiblePaths.unshift(join(dirPath, entry))
      }
    }
  } catch {
    // Directory doesn't exist
  }
  
  // Try each possible path
  for (const filePath of possiblePaths) {
    try {
      const stats = await stat(filePath)
      if (!stats.isFile()) continue
      
      const ext = extname(filePath).toLowerCase()
      let title: string
      let description: string | undefined
      let order: number
      let type: 'markdown' | 'openapi' | 'postman'
      
      if (ext === '.md') {
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
