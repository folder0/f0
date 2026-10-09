/**
 * =============================================================================
 * F0 - BRAND API ENDPOINT
 * =============================================================================
 * 
 * GET /api/brand
 * 
 * Returns the brand configuration from _brand.md for frontend consumption.
 * Used by Header, Layout, and theme components to apply white-label settings.
 * 
 * RESPONSE:
 * {
 *   "logo": "/api/content/assets/images/logo.svg",
 *   "logoDark": "/api/content/assets/images/logo-dark.svg",
 *   "favicon": "/api/content/assets/images/favicon.png",
 *   "accentColor": "#2563eb",
 *   "headerStyle": "logo_and_text",
 *   "footerText": "© 2026 Acme Corp.",
 *   "footerLinks": [{ "label": "Privacy", "url": "/privacy" }],
 *   "customCss": "/api/content/assets/css/custom.css",
 *   "siteName": "Acme Docs",
 *   "siteDescription": "Documentation"
 * }
 */

import { getBrandConfig } from '../utils/brand'
import { f0Config } from '../utils/f0-config'

export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  const settings = f0Config()
  const brand = getBrandConfig(settings.contentDir)

  return {
    ...brand,
    siteName: config.public.siteName,
    siteDescription: config.public.siteDescription,
  }
})
