/**
 * =============================================================================
 * F0 - SEMANTIC SEARCH API FOR AI AGENTS
 * =============================================================================
 * 
 * GET /api/agents/search?q=query&limit=5&include_content=true
 * 
 * A search endpoint optimized for AI agents, LLMs, and retrieval systems.
 * Returns structured, context-rich results designed for programmatic consumption.
 * 
 * QUERY PARAMETERS:
 * - q: Search query (required)
 * - limit: Maximum results to return (default: 5, max: 20)
 * - include_content: Include full page content in results (default: false)
 * - section: Filter by section (optional)
 * 
 * RESPONSE:
 * {
 *   "query": "authentication setup",
 *   "total": 3,
 *   "results": [
 *     {
 *       "title": "Authentication Setup",
 *       "path": "/guides/authentication/setup",
 *       "url": "https://docs.example.com/guides/authentication/setup",
 *       "section": "Guides",
 *       "relevance": 0.95,
 *       "excerpt": "To configure authentication...",
 *       "content": "Full markdown content...",  // if include_content=true
 *       "headings": ["Overview", "Setup", "Configuration"],
 *       "metadata": {
 *         "wordCount": 450,
 *         "lastModified": "2026-01-24"
 *       }
 *     }
 *   ],
 *   "suggested_queries": ["OTP setup", "email authentication"],
 *   "api_info": {
 *     "endpoint": "/api/agents/search",
 *     "llms_txt": "/llms.txt",
 *     "raw_markdown": "/api/content/raw/{path}"
 *   }
 * }
 * 
 * USAGE EXAMPLES:
 * - Basic: GET /api/agents/search?q=authentication
 * - With content: GET /api/agents/search?q=authentication&include_content=true
 * - Limited: GET /api/agents/search?q=api&limit=3
 * - Filtered: GET /api/agents/search?q=setup&section=Guides
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative } from 'path'
import { logger } from '../../utils/logger'
import { isConfinedEntry } from '../../utils/paths'
import { f0Config } from '../../utils/f0-config'
import { fileToUrlPath, readFrontmatter, resolvePageTitle, titleFromFileName } from '../../utils/content-core'
import { hiddenFromListings } from '../../utils/drafts'
import { onContentChange } from '../../utils/invalidation'

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
  url: string
  section: string
  relevance: number
  excerpt: string
  content?: string
  headings: string[]
  metadata: {
    wordCount: number
    hasCodeBlocks: boolean
    hasApiEndpoints: boolean
  }
}

interface ContentItem {
  title: string
  path: string
  content: string
  rawMarkdown: string
  section: string
  headings: string[]
  wordCount: number
  hasCodeBlocks: boolean
  hasApiEndpoints: boolean
}

// Cache for content index
let contentIndex: ContentItem[] | null = null
let indexTimestamp: number = 0
onContentChange('agent-search', () => { contentIndex = null })
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
          await scanDir(fullPath, titleFromFileName(entry.name) || section)
        } else if (entry.name.endsWith('.md') && await isConfinedEntry(dir, entry, contentDir)) {
          try {
            const rawContent = await readFile(fullPath, 'utf-8')
            const doc = readFrontmatter(rawContent)
            if (hiddenFromListings(doc.data, 'site')) continue
            const mdContent = doc.body
            
            // Same URL and title rules as the sidebar and the page itself
            const urlPath = fileToUrlPath(relative(contentDir, fullPath))
            const title = resolvePageTitle(doc, entry.name)
            
            // Extract headings
            const headings = extractHeadings(mdContent)
            
            // Convert to plain text
            const plainContent = markdownToPlainText(mdContent)
            
            // Analyze content
            const hasCodeBlocks = /```[\s\S]*?```/.test(mdContent)
            const hasApiEndpoints = /:::api\s+(GET|POST|PUT|PATCH|DELETE)/.test(mdContent) ||
                                   /^(GET|POST|PUT|PATCH|DELETE)\s+\//.test(mdContent)
            
            items.push({
              title,
              path: urlPath,
              content: plainContent,
              rawMarkdown: rawContent,
              section: section || 'Home',
              headings,
              wordCount: plainContent.split(/\s+/).length,
              hasCodeBlocks,
              hasApiEndpoints,
            })
          } catch (e) {
            logger.warn('Error reading file for agent search', { path: fullPath })
          }
        }
      }
    } catch (e) {
      logger.warn('Error scanning for agent search', { path: dir })
    }
  }
  
  await scanDir(contentDir)
  
  contentIndex = items
  indexTimestamp = now
  
  return items
}

/**
 * Extract H2 and H3 headings from markdown
 */
function extractHeadings(content: string): string[] {
  const headingRegex = /^#{2,3}\s+(.+)$/gm
  const headings: string[] = []
  let match
  
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[1].trim())
  }
  
  return headings
}

/**
 * Convert markdown to plain text
 */
function markdownToPlainText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '[code block]')
    // Keep inline code text: identifiers are what agents search for
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '[image]')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    // Emphasis never starts or ends next to a space, and underscores inside
    // words (snake_case, NUXT_PUBLIC_SITE_NAME) are not emphasis
    .replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, '$1')
    .replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])__(?!\s)([^_\n]+?)(?<!\s)__(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/(^|[^\p{L}\p{N}_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/:::(info|warning|error|success|api|tip|note|danger)/g, '')
    .replace(/:::/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Calculate semantic relevance score
 */
function calculateRelevance(item: ContentItem, queryTerms: string[]): number {
  const titleLower = item.title.toLowerCase()
  const contentLower = item.content.toLowerCase()
  const pathLower = item.path.toLowerCase()
  const headingsLower = item.headings.map(h => h.toLowerCase()).join(' ')
  
  let score = 0
  let matchedTerms = 0
  
  for (const term of queryTerms) {
    // Title match (highest weight)
    if (titleLower.includes(term)) {
      score += 30
      matchedTerms++
      if (titleLower === term) score += 20
    }
    
    // Heading match (high weight)
    if (headingsLower.includes(term)) {
      score += 15
      matchedTerms++
    }
    
    // Path match (medium weight)
    if (pathLower.includes(term)) {
      score += 10
      matchedTerms++
    }
    
    // Content match (base weight)
    const contentMatches = countOccurrences(contentLower, term)
    if (contentMatches > 0) {
      score += Math.min(contentMatches * 2, 10)
      matchedTerms++
    }
  }
  
  // Normalize to 0-1 range
  const maxPossibleScore = queryTerms.length * (30 + 20 + 15 + 10 + 10)
  return Math.min(score / maxPossibleScore, 1)
}

/**
 * Generate context-rich excerpt
 */
function generateExcerpt(content: string, terms: string[], length: number = 200): string {
  const contentLower = content.toLowerCase()
  
  // Find best match position
  let bestIndex = -1
  let bestTerm = ''
  
  for (const term of terms) {
    const index = contentLower.indexOf(term)
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index
      bestTerm = term
    }
  }
  
  if (bestIndex === -1) {
    return content.slice(0, length) + (content.length > length ? '...' : '')
  }
  
  const start = Math.max(0, bestIndex - 50)
  const end = Math.min(content.length, bestIndex + length - 50)
  
  let excerpt = content.slice(start, end)
  if (start > 0) excerpt = '...' + excerpt
  if (end < content.length) excerpt = excerpt + '...'
  
  return excerpt
}

/**
 * Generate suggested related queries
 */
function generateSuggestedQueries(results: SearchResult[], originalQuery: string): string[] {
  const suggestions = new Set<string>()
  const queryLower = originalQuery.toLowerCase()
  
  for (const result of results.slice(0, 3)) {
    // Add section-based suggestions
    if (!queryLower.includes(result.section.toLowerCase())) {
      suggestions.add(`${originalQuery} ${result.section.toLowerCase()}`)
    }
    
    // Add heading-based suggestions
    for (const heading of result.headings.slice(0, 2)) {
      const headingLower = heading.toLowerCase()
      if (!queryLower.includes(headingLower) && headingLower.length < 30) {
        suggestions.add(headingLower)
      }
    }
  }
  
  return Array.from(suggestions).slice(0, 3)
}

export default defineEventHandler(async (event) => {
  const settings = f0Config()
  const query = getQuery(event)
  
  // Parse query parameters
  const searchQuery = (query.q as string || '').trim()
  const limit = Math.min(Math.max(parseInt(query.limit as string) || 5, 1), 20)
  const includeContent = query.include_content === 'true'
  const sectionFilter = (query.section as string || '').trim()
  
  // Get host for full URLs
  const host = getRequestHost(event)
  const protocol = getRequestProtocol(event)
  const baseUrl = `${protocol}://${host}`
  
  if (!searchQuery) {
    return {
      query: '',
      total: 0,
      results: [],
      api_info: {
        endpoint: '/api/agents/search',
        llms_txt: '/llms.txt',
        raw_markdown: '/api/content/raw/{path}',
        parameters: {
          q: 'Search query (required)',
          limit: 'Max results (default: 5, max: 20)',
          include_content: 'Include full content (default: false)',
          section: 'Filter by section (optional)',
        },
      },
    }
  }
  
  // Build/get content index
  const index = await buildContentIndex(settings.contentDir)
  
  // Filter by section if specified
  let searchItems = index
  if (sectionFilter) {
    searchItems = index.filter(item => 
      item.section.toLowerCase() === sectionFilter.toLowerCase()
    )
  }
  
  // Parse query terms
  const queryTerms = searchQuery.toLowerCase().split(/\s+/).filter(t => t.length > 1)
  
  if (queryTerms.length === 0) {
    return {
      query: searchQuery,
      total: 0,
      results: [],
      suggested_queries: [],
      api_info: {
        endpoint: '/api/agents/search',
        llms_txt: '/llms.txt',
        raw_markdown: '/api/content/raw/{path}',
      },
    }
  }
  
  // Score and rank results
  const scoredResults: (ContentItem & { relevance: number })[] = []
  
  for (const item of searchItems) {
    const relevance = calculateRelevance(item, queryTerms)
    if (relevance > 0.05) {
      scoredResults.push({ ...item, relevance })
    }
  }
  
  // Sort by relevance
  scoredResults.sort((a, b) => b.relevance - a.relevance)
  
  // Take top results
  const topResults = scoredResults.slice(0, limit)
  
  // Format results for AI consumption
  const results: SearchResult[] = topResults.map(item => ({
    title: item.title,
    path: item.path,
    url: `${baseUrl}${item.path}`,
    section: item.section,
    relevance: Math.round(item.relevance * 100) / 100,
    excerpt: generateExcerpt(item.content, queryTerms),
    ...(includeContent && { content: item.rawMarkdown }),
    headings: item.headings,
    metadata: {
      wordCount: item.wordCount,
      hasCodeBlocks: item.hasCodeBlocks,
      hasApiEndpoints: item.hasApiEndpoints,
    },
  }))
  
  // Generate suggested queries
  const suggestedQueries = generateSuggestedQueries(results, searchQuery)
  
  return {
    query: searchQuery,
    total: results.length,
    results,
    suggested_queries: suggestedQueries,
    api_info: {
      endpoint: '/api/agents/search',
      llms_txt: `${baseUrl}/llms.txt`,
      raw_markdown: `${baseUrl}/api/content/raw/{path}`,
    },
  }
})
