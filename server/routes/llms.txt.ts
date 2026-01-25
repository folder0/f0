/**
 * =============================================================================
 * F0 - /llms.txt ROUTE
 * =============================================================================
 * 
 * GET /llms.txt
 * 
 * Returns the complete documentation in a plain text format optimized for
 * LLM/AI agent ingestion. This is the "AI-first" part of the tri-brid
 * rendering strategy.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-AI-LLMS-NO-UI-NOISE-004: No navigation, styling, or UI chrome
 * - C-AI-TRIBRID-CONSISTENCY-003: Same source, different render
 * 
 * OUTPUT FORMAT:
 * - Plain text (text/plain)
 * - Hierarchical structure with clear separators
 * - Source file paths for traceability
 * - No HTML, CSS, or JavaScript
 * 
 * CACHING:
 * - 1 hour cache (configured in nuxt.config.ts routeRules)
 * - Invalidated when content changes
 */

import { generateLlmText } from '../utils/llm-generator'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  
  try {
    // Generate LLM-optimized text
    const llmText = await generateLlmText(
      config.contentDir,
      config.public.siteName
    )
    
    // Set content type to plain text
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    
    // Add cache headers (also set in nuxt.config.ts routeRules)
    setHeader(event, 'Cache-Control', 'public, max-age=3600')
    
    return llmText
    
  } catch (error) {
    console.error('[llms.txt] Error generating LLM text:', error)
    
    // Return error in plain text format
    setHeader(event, 'Content-Type', 'text/plain; charset=utf-8')
    
    return `# Error\n\nFailed to generate documentation context.\nPlease try again later.`
  }
})
