/**
 * =============================================================================
 * F0 - /llms-full.txt ROUTE
 * =============================================================================
 *
 * GET /llms-full.txt                   → Full site documentation as plain text
 * GET /llms-full.txt?section=guides    → Only /guides content
 *
 * The llmstxt.org location for the full text. Identical to today's /llms.txt.
 */

import { sendLlmsFullText } from '../utils/llms-full'

export default defineEventHandler(event => sendLlmsFullText(event))
