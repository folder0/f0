/**
 * =============================================================================
 * F0 - MARKDOWN AT EVERY PAGE URL
 * =============================================================================
 *
 * A page's URL with .md appended returns its Markdown source:
 *   /guides/intro     → the rendered page
 *   /guides/intro.md  → text/markdown, the file as written
 *   /home.md          → the home page source
 *
 * For agents and tools that read Markdown. Runs after the auth middleware
 * (files run in name order), so private sites stay private.
 */

import { sendRawMarkdown } from '../utils/raw-markdown'

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const path = getRequestURL(event).pathname
  if (!path.endsWith('.md') || path.startsWith('/api/') || path.startsWith('/_nuxt/')) return

  let slug: string
  try {
    slug = decodeURIComponent(path.slice(1, -'.md'.length))
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }
  if (slug.endsWith('/')) slug = slug.slice(0, -1)

  return sendRawMarkdown(event, slug === 'home' ? '' : slug)
})
