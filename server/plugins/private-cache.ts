/**
 * =============================================================================
 * F0 - PRIVATE-MODE CACHE HEADERS
 * =============================================================================
 *
 * In private mode every response that can carry content must stay out of
 * shared caches (CDNs such as Cloudflare, corporate proxies). Route handlers
 * and routeRules set `Cache-Control: public, ...` for llms.txt, raw markdown,
 * assets, sitemap and feeds, which is right for public sites but leaks gated
 * content when the site is private.
 *
 * This hook runs after the handler, so it overrides those headers (the auth
 * middleware sets the same headers earlier, for redirects and 401s):
 *   Cache-Control: private, no-store
 *   Vary: Cookie, Authorization
 *
 * Exempt: /_nuxt/* (fingerprinted build assets, no site content), and any
 * response whose headers were already sent (e.g. redirects).
 */

import { logger } from '../utils/logger'
import { markPrivateResponse } from '../utils/http-cache'
import { f0Config } from '../utils/f0-config'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('beforeResponse', (event) => {
    const settings = f0Config()
    if (settings.authMode !== 'private') return
    if (event.node.res.headersSent) return

    const path = getRequestURL(event).pathname
    if (path.startsWith('/_nuxt/')) return

    try {
      markPrivateResponse(event)
    }
    catch (error) {
      logger.warn('Could not set private cache headers', { path, error: error instanceof Error ? error.message : String(error) })
    }
  })
})
