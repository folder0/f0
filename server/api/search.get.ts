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
import { f0Config } from '../utils/f0-config'
import { fileToUrlPath, readFrontmatter, resolvePageTitle, titleFromFileName } from '../utils/content-core'
import { hiddenFromListings } from '../utils/drafts'
import MiniSearch from 'minisearch'
import { onContentChange } from '../utils/invalidation'

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
// Full-text index over the same items: prefix matches while typing, small
// typos forgiven, title and path weighted above body text
let searchIndex: MiniSearch<IndexedItem> | null = null
onContentChange('search', () => { contentIndex = null; searchIndex = null })

interface IndexedItem extends ContentItem {
  id: number
}

function buildSearchIndex(items: ContentItem[]): MiniSearch<IndexedItem> {
  const index = new MiniSearch<IndexedItem>({
    fields: ['title', 'path', 'section', 'content'],
    // Split paths and identifiers on separators as well as spaces
    tokenize: text => text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean),
  })
  index.addAll(items.map((item, id) => ({ ...item, id })))
  return index
}
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
          await scanDir(fullPath, titleFromFileName(entry.name) || section)
        } else if (entry.name.endsWith('.md') && await isConfinedEntry(dir, entry, contentDir)) {
          try {
            const fullFilePath = fullPath
            
            // Use the content cache for parsed data when possible
            let title: string
            let plainContent: string
            
            let frontmatter: Record<string, unknown>
            try {
              const cached = await getCachedContent(fullFilePath)
              title = cached.title
              plainContent = cached.plainText
              frontmatter = cached.frontmatter
            } catch {
              // Fallback to lightweight extraction if cache fails
              const doc = readFrontmatter(await readFile(fullPath, 'utf-8'))
              title = resolvePageTitle(doc, entry.name)
              plainContent = markdownToPlainTextSimple(doc.body)
              frontmatter = doc.data
            }
            if (hiddenFromListings(frontmatter, 'site')) continue
            
            // Same URL rules as the sidebar (dated posts used to get /blog/02-11-x)
            const urlPath = fileToUrlPath(relative(contentDir, fullPath))
            
            items.push({
              title,
              path: urlPath,
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
  searchIndex = buildSearchIndex(items)
  indexTimestamp = now
  
  return items
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
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1)
  if (terms.length === 0) return []

  const index = searchIndex ?? (searchIndex = buildSearchIndex(items))
  const hits = index.search(terms.join(' '), {
    prefix: true,
    fuzzy: term => (term.length > 4 ? 0.2 : false),
    boost: { title: 4, path: 2, section: 1.5 },
  })

  return hits.slice(0, 10).map((hit) => {
    const item = items[hit.id as number]
    return {
      title: item.title,
      path: item.path,
      // Center the excerpt on what actually matched (prefix and fuzzy hits
      // match other words than the ones typed)
      excerpt: generateExcerpt(item.content, [...new Set([...hit.terms, ...terms])]),
      section: item.section,
      score: hit.score,
    }
  })
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
  const settings = f0Config()
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
  const index = await buildContentIndex(settings.contentDir)
  
  // Search
  const results = searchContent(index, searchQuery)
  
  return {
    results: results.map(({ score, ...rest }) => rest), // Remove score from response
    query: searchQuery,
    total: results.length,
  }
})
