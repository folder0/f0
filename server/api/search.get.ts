/**
 * =============================================================================
 * F0 - SEARCH API ENDPOINT
 * =============================================================================
 * 
 * GET /api/search?q=query
 * 
 * Searches all documentation content and returns matching results.
 * Uses simple text matching for now - can be upgraded to full-text search later.
 * 
 * RESPONSE:
 * {
 *   "results": [
 *     {
 *       "title": "Getting Started",
 *       "path": "/guides/getting-started",
 *       "excerpt": "...matching text...",
 *       "section": "Guides"
 *     }
 *   ],
 *   "query": "search term",
 *   "total": 5
 * }
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import { getCachedContent } from '../utils/cache'
import { logger } from '../utils/logger'
import { isConfinedEntry } from '../utils/paths'

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 * Uses indexOf rather than a user-built RegExp to avoid regex injection / ReDoS.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

interface SearchResult {
  title: string
  path: string
  excerpt: string
  section: string
  score: number
}

interface ContentItem {
  title: string
  path: string
  content: string
  section: string
}

// Cache for content index
let contentIndex: ContentItem[] | null = null
let indexTimestamp: number = 0
const INDEX_TTL = 60000 // Rebuild index every 60 seconds

/**
 * Build content index by scanning all markdown files
 */
async function buildContentIndex(contentDir: string): Promise<ContentItem[]> {
  const now = Date.now()
  
  // Return cached index if still valid
  if (contentIndex && (now - indexTimestamp) < INDEX_TTL) {
    return contentIndex
  }
  
  const items: ContentItem[] = []
  
  async function scanDir(dir: string, section: string = '') {
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        
        // Skip hidden files, assets, private
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
        if (entry.name === 'assets' || entry.name === 'images' || entry.name === 'private') continue
        if (entry.name === 'nav.md') continue
        
        if (entry.isDirectory()) {
          // Determine section name from folder
          const sectionName = entry.name.replace(/^\d+-/, '')
            .split('-')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
          
          await scanDir(fullPath, sectionName || section)
        } else if (entry.name.endsWith('.md') && await isConfinedEntry(dir, entry, contentDir)) {
          try {
            const fullFilePath = fullPath
            
            // Use the content cache for parsed data when possible
            let title: string
            let plainContent: string
            
            try {
              const cached = await getCachedContent(fullFilePath)
              title = cached.title
              plainContent = cached.plainText
            } catch {
              // Fallback to lightweight extraction if cache fails
              const content = await readFile(fullPath, 'utf-8')
              const { frontmatter, content: mdContent } = extractFrontmatterSimple(content)
              title = frontmatter?.title as string || ''
              if (!title) {
                const h1Match = mdContent.match(/^#\s+(.+)$/m)
                title = h1Match ? h1Match[1] : entry.name.replace(/\.md$/, '')
              }
              plainContent = markdownToPlainTextSimple(mdContent)
            }
            
            // Build URL path
            const relativePath = relative(contentDir, fullPath)
            const urlPath = '/' + relativePath
              .replace(/\\/g, '/')
              .replace(/^\d+-/, '')
              .replace(/\/\d+-/g, '/')
              .replace(/^\d{4}-\d{2}-\d{2}-/g, '')
              .replace(/\/\d{4}-\d{2}-\d{2}-/g, '/')
              .replace(/\.md$/, '')
              .replace(/\/index$/, '')
              .replace(/^home$/, '')
            
            items.push({
              title,
              path: urlPath || '/',
              content: plainContent,
              section: section || 'Home',
            })
          } catch (e) {
            logger.warn('Error reading file for search', { path: fullPath })
          }
        }
      }
    } catch (e) {
      logger.warn('Error scanning directory for search', { path: dir })
    }
  }
  
  await scanDir(contentDir)
  
  // Cache the index
  contentIndex = items
  indexTimestamp = now
  
  return items
}

/**
 * Simple frontmatter extraction (avoid importing complex module)
 */
function extractFrontmatterSimple(content: string): { frontmatter: Record<string, unknown>, content: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/)
  
  if (!match) {
    return { frontmatter: {}, content }
  }
  
  try {
    // Simple YAML parsing for common fields
    const yamlContent = match[1]
    const frontmatter: Record<string, unknown> = {}
    
    const lines = yamlContent.split('\n')
    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim()
        let value = line.slice(colonIndex + 1).trim()
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        frontmatter[key] = value
      }
    }
    
    return { frontmatter, content: content.slice(match[0].length) }
  } catch {
    return { frontmatter: {}, content }
  }
}

/**
 * Simple markdown to plain text conversion
 */
function markdownToPlainTextSimple(content: string): string {
  return content
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`[^`]+`/g, '')
    // Remove images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // Convert links to just text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove callout markers
    .replace(/:::(info|warning|error|success)/g, '')
    .replace(/:::/g, '')
    // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Search content and return ranked results
 */
function searchContent(items: ContentItem[], query: string): SearchResult[] {
  const queryLower = query.toLowerCase()
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1)
  
  if (queryTerms.length === 0) {
    return []
  }
  
  const results: SearchResult[] = []
  
  for (const item of items) {
    const titleLower = item.title.toLowerCase()
    const contentLower = item.content.toLowerCase()
    
    // Calculate relevance score
    let score = 0
    let matchedTerms = 0
    
    for (const term of queryTerms) {
      // Title match (high score)
      if (titleLower.includes(term)) {
        score += 10
        matchedTerms++
        
        // Exact title match bonus
        if (titleLower === term) {
          score += 20
        }
      }
      
      // Content match
      const contentMatches = countOccurrences(contentLower, term)
      if (contentMatches > 0) {
        score += Math.min(contentMatches, 5) // Cap at 5 matches
        matchedTerms++
      }
      
      // Path match
      if (item.path.toLowerCase().includes(term)) {
        score += 3
        matchedTerms++
      }
    }
    
    // Only include if at least one term matched
    if (matchedTerms > 0) {
      // Generate excerpt around first match
      const excerpt = generateExcerpt(item.content, queryTerms)
      
      results.push({
        title: item.title,
        path: item.path,
        excerpt,
        section: item.section,
        score,
      })
    }
  }
  
  // Sort by score descending
  results.sort((a, b) => b.score - a.score)
  
  // Return top 10 results
  return results.slice(0, 10)
}

/**
 * Generate an excerpt with context around the match
 */
function generateExcerpt(content: string, terms: string[]): string {
  const contentLower = content.toLowerCase()
  const excerptLength = 150
  
  // Find first matching term
  let firstMatchIndex = -1
  for (const term of terms) {
    const index = contentLower.indexOf(term)
    if (index !== -1 && (firstMatchIndex === -1 || index < firstMatchIndex)) {
      firstMatchIndex = index
    }
  }
  
  if (firstMatchIndex === -1) {
    // No match found, return start of content
    return content.slice(0, excerptLength) + (content.length > excerptLength ? '...' : '')
  }
  
  // Calculate excerpt boundaries
  const start = Math.max(0, firstMatchIndex - 50)
  const end = Math.min(content.length, firstMatchIndex + excerptLength - 50)
  
  let excerpt = content.slice(start, end)
  
  // Add ellipsis if needed
  if (start > 0) excerpt = '...' + excerpt
  if (end < content.length) excerpt = excerpt + '...'
  
  return excerpt
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const query = getQuery(event)
  const searchQuery = (query.q as string || '').trim()
  
  if (!searchQuery) {
    return {
      results: [],
      query: '',
      total: 0,
    }
  }
  
  // Build/get content index
  const index = await buildContentIndex(config.contentDir)
  
  // Search
  const results = searchContent(index, searchQuery)
  
  return {
    results: results.map(({ score, ...rest }) => rest), // Remove score from response
    query: searchQuery,
    total: results.length,
  }
})
