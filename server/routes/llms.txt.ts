/**
 * =============================================================================
 * F0 - /llms.txt ROUTE
 * =============================================================================
 * 
 * GET /llms.txt                        → Full site documentation
 * GET /llms.txt?section=guides         → Only /guides content
 * GET /llms.txt?section=api            → Only /api content
 * GET /llms.txt?section=guides/auth    → Only /guides/auth subtree
 * 
 * Returns documentation in plain text optimized for LLM/AI agent ingestion.
 * Section filtering allows agents to fetch only what they need, keeping
 * within context window limits.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-AI-LLMS-NO-UI-NOISE-004: No navigation, styling, or UI chrome
 * - C-AI-TRIBRID-CONSISTENCY-003: Same source, different render
 * 
 * CACHING:
 * - Full site and per-section caching via content hash invalidation
 */

import { getCachedLlmsTxt } from '../utils/llms-cache'
import { logger } from '../utils/logger'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const query = getQuery(event)
  
  // Parse section filter
  const sectionParam = query.section as string | undefined
  const sections = sectionParam
    ? [sectionParam.startsWith('/') ? sectionParam : `/${sectionParam}`]
    : []
  
  try {
    const llmText = await getCachedLlmsTxt(
      config.contentDir,
      config.public.siteName,
      sections.length > 0 ? { sections } : {}
    )
    
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    setHeader(event, 'Cache-Control', 'public, max-age=3600')
    
    return llmText
    
  } catch (error) {
    logger.error('Failed to generate /llms.txt', {
      error: error instanceof Error ? error.message : String(error),
      section: sectionParam,
    })
    
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    return `# Error\n\nFailed to generate documentation context.\nPlease try again later.`
  }
})
