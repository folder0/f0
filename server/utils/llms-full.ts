/**
 * =============================================================================
 * F0 - LLM FULL-TEXT CONTEXT
 * =============================================================================
 *
 * The whole site (or one ?section=) as plain text for AI agents. Served at
 * /llms-full.txt, and for now also at /llms.txt (see server/routes/llms.txt.ts).
 */

import type { H3Event } from 'h3'
import { getCachedLlmsTxt } from './llms-cache'
import { logger } from './logger'
import { f0Config } from './f0-config'
import { stripOrderPrefix } from './content-core'

/** The full-text documentation context, optionally limited to ?section=. */
export async function sendLlmsFullText(event: H3Event): Promise<string> {
  const config = useRuntimeConfig()
  const settings = f0Config()
  const query = getQuery(event)
  
  // Parse section filter
  const sectionParam = query.section as string | undefined
  // Match on URL names, so ?section=02-reference and ?section=reference both
  // select content/02-reference
  const sections = typeof sectionParam === 'string' && sectionParam
    ? ['/' + sectionParam.split('/').filter(Boolean).map(stripOrderPrefix).join('/')]
    : []
  
  try {
    const llmText = await getCachedLlmsTxt(
      settings.contentDir,
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
}
