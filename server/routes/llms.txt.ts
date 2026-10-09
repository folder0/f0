/**
 * =============================================================================
 * F0 - /llms.txt ROUTE
 * =============================================================================
 * 
 * GET /llms.txt                        → Full site documentation
 *                                         (same as /llms-full.txt; see NOTICE)
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

import { sendLlmsFullText } from '../utils/llms-full'

/**
 * NOTICE: by the llms.txt convention (llmstxt.org), /llms.txt is a short index
 * of links and the full text lives at /llms-full.txt. f0 serves the full text
 * at both for now; a later release turns /llms.txt into the index. Agents that
 * want the full text should use /llms-full.txt. Every /llms.txt response says
 * so in a Link header and an X-F0-Notice header.
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Link', '</llms-full.txt>; rel="alternate"; type="text/plain"')
  setHeader(event, 'X-F0-Notice', '/llms.txt will become an index of links in a later release; use /llms-full.txt for the full text')
  return sendLlmsFullText(event)
})
