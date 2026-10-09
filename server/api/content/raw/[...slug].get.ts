/**
 * =============================================================================
 * F0 - RAW MARKDOWN API ENDPOINT
 * =============================================================================
 * 
 * GET /api/content/raw/[...slug]
 * 
 * Returns the raw markdown content for a given page.
 * Designed for AI agents, copy functionality, and programmatic access.
 * 
 * EXAMPLES:
 * - GET /api/content/raw/guides/getting-started
 * - GET /api/content/raw/guides/authentication/setup
 * 
 * QUERY PARAMETERS:
 * - download: If 'true', sets Content-Disposition header for file download
 * 
 * RESPONSE:
 * Returns raw markdown text with Content-Type: text/markdown
 * 
 * HEADERS:
 * - Content-Type: text/markdown; charset=utf-8
 * - X-Page-Title: Page Title
 * - X-Page-Path: /guides/getting-started
 * - X-Word-Count: 450
 */

import { sendRawMarkdown } from '../../../utils/raw-markdown'

export default defineEventHandler((event) => {
  return sendRawMarkdown(event, event.context.params?.slug || '', { download: getQuery(event).download === 'true' })
})
