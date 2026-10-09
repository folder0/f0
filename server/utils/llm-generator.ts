/**
 * =============================================================================
 * F0 - LLM TEXT GENERATOR
 * =============================================================================
 * 
 * This module generates the /llms.txt output - a plain text stream optimized
 * for AI agent consumption. It concatenates all documentation into a single
 * context-dense file with structural metadata.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-AI-LLMS-NO-UI-NOISE-004: Excludes all UI, styling, navigation chrome
 * - C-AI-TRIBRID-CONSISTENCY-003: Same source files, different render
 * 
 * OUTPUT FORMAT:
 * ```
 * # f0 - Documentation Context
 * > SYSTEM INFO: Optimized for LLM ingestion.
 * > GENERATED: 2026-01-24T12:00:00Z
 * 
 * ---
 * ## PATH: Guides > Authentication > Setup
 * (Source: /guides/auth/setup.md)
 * 
 * [Content here...]
 * 
 * ---
 * ```
 * 
 * DESIGN DECISIONS:
 * - Hierarchical path headers help LLMs understand document structure
 * - Source file paths provide traceability
 * - Clear separators between documents
 * - Plain text only - no HTML, no CSS, no images
 * - YouTube/media converted to text references
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, extname, basename } from 'path'
import { buildNavigation, type TopNavItem, type SidebarItem } from './navigation'
import { markdownToPlainText, isMarkdownFile, isJsonSpecFile, extractDateFromFilename } from './markdown'
import { parseApiSpec, apiSpecToPlainText } from './openapi-parser'
import { resolveLayoutForPath } from './config'
import { logger } from './logger'
import { isConfinedEntry } from './paths'
import { readFrontmatter, resolvePageTitle } from './content-core'
import { hiddenFromListings } from './drafts'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Options for LLM text generation
 */
export interface LlmGeneratorOptions {
  // Include API specs (OpenAPI/Postman)
  includeApiSpecs?: boolean
  
  // Maximum total size in characters (for context window management)
  maxSize?: number
  
  // Sections to include (if empty, include all)
  sections?: string[]
}

/**
 * Content item for generation
 */
interface ContentItem {
  path: string       // URL path (e.g., /guides/auth/setup)
  sourcePath: string // Filesystem path relative to content dir
  title: string
  content: string    // Plain text content
  order: number
  // Blog metadata (only present for blog posts)
  blogMeta?: {
    type: 'blog-post'
    date: string
    author: string
    tags: string[]
  }
}

// =============================================================================
// CONTENT COLLECTION
// =============================================================================

/**
 * Recursively collect all content files from a directory
 */
async function collectContent(
  dirPath: string,
  contentDir: string,
  urlPath: string = ''
): Promise<ContentItem[]> {
  const items: ContentItem[] = []
  
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name)
      const entryUrlPath = urlPath 
        ? `${urlPath}/${entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^\d+-/, '').replace(/\.(md|json)$/, '')}`
        : entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/^\d+-/, '').replace(/\.(md|json)$/, '')
      
      // Skip hidden files, special files, and assets
      if (
        entry.name.startsWith('.') ||
        entry.name.startsWith('_') ||
        entry.name === 'nav.md' ||
        entry.name === 'assets' ||
        entry.name === 'images'
      ) {
        continue
      }
      
      if (entry.isDirectory()) {
        // Recurse into subdirectory
        const subItems = await collectContent(entryPath, contentDir, entryUrlPath)
        items.push(...subItems)
      } else if (isMarkdownFile(entry.name) && await isConfinedEntry(dirPath, entry, contentDir)) {
        // Process markdown file — skip on failure rather than crashing
        try {
          const rawContent = await readFile(entryPath, 'utf-8')
          const doc = readFrontmatter(rawContent)
          if (hiddenFromListings(doc.data, 'site')) continue
          
          // Use safe plain text extraction
          let plainText: string
          try {
            plainText = markdownToPlainText(rawContent)
          } catch {
            // If even plain text extraction fails, use raw content stripped of frontmatter
            logger.warn('Plain text extraction failed, using raw content', { path: entryPath })
            plainText = doc.body
          }
        
        // Same title rule as the page (frontmatter title, H1, file name)
        const title = resolvePageTitle(doc, entry.name)
        
        // Order: frontmatter `order`, then the file name's number prefix
        let order = 999
        const orderMatch = entry.name.match(/^(\d+)-/)
        if (orderMatch) {
          order = parseInt(orderMatch[1], 10)
        }
        if (typeof doc.data.order === 'number' && Number.isInteger(doc.data.order) && doc.data.order >= 0) {
          order = doc.data.order
        }
        
        items.push({
          path: `/${entryUrlPath}`,
          sourcePath: relative(contentDir, entryPath),
          title,
          content: plainText,
          order,
          // Check if this file is in a blog directory and add metadata
          blogMeta: (() => {
            try {
              const layout = resolveLayoutForPath(contentDir, entryUrlPath, entryPath)
              if (layout === 'blog') {
                const frontmatter = doc.data
                let date = ''
                if (frontmatter.date) {
                  const d = frontmatter.date
                  date = d instanceof Date ? d.toISOString().split('T')[0] : String(d)
                } else {
                  const fd = extractDateFromFilename(entry.name)
                  if (fd) date = fd
                }
                return {
                  type: 'blog-post' as const,
                  date,
                  author: (frontmatter.author as string) || '',
                  tags: Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]).map(t => String(t)) : [],
                }
              }
            } catch {}
            return undefined
          })(),
        })
        } catch (fileError) {
          // Skip this file but log the error — don't crash the entire endpoint
          logger.warn('Skipping file in llms.txt generation', {
            path: entryPath,
            error: fileError instanceof Error ? fileError.message : String(fileError),
          })
        }
      } else if (isJsonSpecFile(entry.name) && await isConfinedEntry(dirPath, entry, contentDir)) {
        // Process API spec file
        try {
          const spec = await parseApiSpec(entryPath)
          const plainText = apiSpecToPlainText(spec)
          
          items.push({
            path: `/${entryUrlPath}`,
            sourcePath: relative(contentDir, entryPath),
            title: spec.title,
            content: plainText,
            order: 999,
          })
        } catch (error) {
          logger.warn('Failed to parse API spec', { path: entryPath, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }
    
    // Sort by order, then alphabetically
    items.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      return a.path.localeCompare(b.path)
    })
    
    return items
  } catch (error) {
    logger.error('Error collecting content', { path: dirPath, error: error instanceof Error ? error.message : String(error) })
    return []
  }
}

// =============================================================================
// PATH FORMATTING
// =============================================================================

/**
 * Convert URL path to readable breadcrumb format
 * /guides/auth/setup → Guides > Auth > Setup
 */
function pathToBreadcrumb(urlPath: string): string {
  return urlPath
    .split('/')
    .filter(Boolean)
    .map(segment => {
      // Convert kebab-case to Title Case
      return segment
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    })
    .join(' > ')
}

// =============================================================================
// MAIN GENERATOR
// =============================================================================

/**
 * Generate the complete /llms.txt content
 * 
 * @param contentDir - Path to content directory
 * @param siteName - Site name for header
 * @param options - Generation options
 * @returns Plain text string optimized for LLM consumption
 */
export async function generateLlmText(
  contentDir: string,
  siteName: string = 'f0',
  options: LlmGeneratorOptions = {}
): Promise<string> {
  const {
    includeApiSpecs = true,
    maxSize,
    sections = [],
  } = options
  
  const timestamp = new Date().toISOString()
  const lines: string[] = []
  
  // Header
  lines.push(`# ${siteName} - Documentation Context`)
  lines.push('')
  lines.push('> SYSTEM INFO: This document is optimized for LLM/AI agent ingestion.')
  lines.push('> It contains the complete documentation in a structured, context-dense format.')
  lines.push('> Navigation chrome, styling, and interactive elements have been stripped.')
  lines.push(`> GENERATED: ${timestamp}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  
  // Collect all content
  let allContent = await collectContent(contentDir, contentDir)
  
  // Filter by sections if specified
  if (sections.length > 0) {
    allContent = allContent.filter(item => {
      return sections.some(section => item.path.startsWith(section))
    })
  }
  
  // Filter out API specs if not included
  if (!includeApiSpecs) {
    allContent = allContent.filter(item => !item.sourcePath.endsWith('.json'))
  }
  
  // Generate content sections
  for (const item of allContent) {
    const breadcrumb = pathToBreadcrumb(item.path) || 'Home'
    
    lines.push(`## PATH: ${breadcrumb}`)
    lines.push(`(Source: ${item.sourcePath})`)
    
    // Blog-specific metadata headers
    if (item.blogMeta) {
      lines.push(`TYPE: ${item.blogMeta.type}`)
      if (item.blogMeta.date) lines.push(`DATE: ${item.blogMeta.date}`)
      if (item.blogMeta.author) lines.push(`AUTHOR: ${item.blogMeta.author}`)
      if (item.blogMeta.tags.length > 0) lines.push(`TAGS: ${item.blogMeta.tags.join(', ')}`)
    }
    
    lines.push('')
    lines.push(item.content)
    lines.push('')
    lines.push('---')
    lines.push('')
  }
  
  // Footer with metadata
  lines.push('')
  lines.push('---')
  lines.push('END OF DOCUMENTATION CONTEXT')
  lines.push(`Total documents: ${allContent.length}`)
  lines.push(`Generated at: ${timestamp}`)
  
  let output = lines.join('\n')
  
  // Truncate if maxSize specified
  if (maxSize && output.length > maxSize) {
    output = output.slice(0, maxSize)
    output += '\n\n[TRUNCATED - Content exceeded maximum size limit]'
  }
  
  return output
}

/**
 * Get content statistics without generating full output
 * Useful for monitoring and optimization
 */
export async function getLlmStats(contentDir: string): Promise<{
  totalDocuments: number
  totalCharacters: number
  estimatedTokens: number
  documentList: Array<{ path: string; characters: number }>
}> {
  const allContent = await collectContent(contentDir, contentDir)
  
  let totalCharacters = 0
  const documentList: Array<{ path: string; characters: number }> = []
  
  for (const item of allContent) {
    const chars = item.content.length
    totalCharacters += chars
    documentList.push({ path: item.path, characters: chars })
  }
  
  // Rough token estimate (1 token ≈ 4 characters for English text)
  const estimatedTokens = Math.ceil(totalCharacters / 4)
  
  return {
    totalDocuments: allContent.length,
    totalCharacters,
    estimatedTokens,
    documentList,
  }
}
