/**
 * =============================================================================
 * F0 - SEARCH API ENDPOINT
 * =============================================================================
 * 
 * GET /api/search?q=query
 * 
 * Searches all documentation content and returns matching results.
 * Full-text search (prefix and typo tolerant) over the shared index in
 * server/utils/search-index.ts, also used by /api/agents/search and /mcp.
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

import { f0Config } from '../utils/f0-config'
import { excerptAround, searchSite } from '../utils/search-index'

export default defineEventHandler(async (event) => {
  const searchQuery = String(getQuery(event).q ?? '').trim()

  if (!searchQuery) {
    return {
      results: [],
      query: '',
      total: 0,
    }
  }

  // One index for the search box, agents and MCP (server/utils/search-index.ts)
  const hits = await searchSite(f0Config().contentDir, searchQuery, { limit: 10 })
  const results = hits.map(({ doc, terms }) => ({
    title: doc.title,
    path: doc.path,
    // Centered on what actually matched (prefix and typo matches included)
    excerpt: excerptAround(doc.content, terms),
    section: doc.section,
  }))

  return {
    results,
    query: searchQuery,
    total: results.length,
  }
})
