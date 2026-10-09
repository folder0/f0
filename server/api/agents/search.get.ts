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

import { f0Config } from '../../utils/f0-config'
import { excerptAround, searchSite } from '../../utils/search-index'

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

const API_INFO = {
  endpoint: '/api/agents/search',
  llms_txt: '/llms.txt',
  raw_markdown: '/api/content/raw/{path}',
}

export default defineEventHandler(async (event) => {
  const settings = f0Config()
  const query = getQuery(event)

  // Parse query parameters
  const searchQuery = String(query.q ?? '').trim()
  const limit = Math.min(Math.max(parseInt(query.limit as string) || 5, 1), 20)
  const includeContent = query.include_content === 'true'
  const sectionFilter = String(query.section ?? '').trim()

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
        ...API_INFO,
        parameters: {
          q: 'Search query (required)',
          limit: 'Max results (default: 5, max: 20)',
          include_content: 'Include full content (default: false)',
          section: 'Filter by section (optional)',
        },
      },
    }
  }

  // The same index as the search box and /mcp (server/utils/search-index.ts):
  // prefix and typo matches, and pages that mention a term only in their body
  // are found too
  const hits = await searchSite(settings.contentDir, searchQuery, { limit, section: sectionFilter || undefined })
  const topScore = hits[0]?.score || 1

  // Format results for AI consumption; relevance is relative to the best match
  const results: SearchResult[] = hits.map(({ doc, score, terms }) => ({
    title: doc.title,
    path: doc.path,
    url: `${baseUrl}${doc.path}`,
    section: doc.section,
    relevance: Math.round((score / topScore) * 100) / 100,
    excerpt: excerptAround(doc.content, terms, 200),
    ...(includeContent && { content: doc.rawMarkdown }),
    headings: doc.headings,
    metadata: {
      wordCount: doc.wordCount,
      hasCodeBlocks: doc.hasCodeBlocks,
      hasApiEndpoints: doc.hasApiEndpoints,
    },
  }))

  return {
    query: searchQuery,
    total: results.length,
    results,
    suggested_queries: generateSuggestedQueries(results, searchQuery),
    api_info: {
      endpoint: '/api/agents/search',
      llms_txt: `${baseUrl}/llms.txt`,
      raw_markdown: `${baseUrl}/api/content/raw/{path}`,
    },
  }
})
