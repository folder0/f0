/**
 * =============================================================================
 * F0 - NAVIGATION API ENDPOINT
 * =============================================================================
 * 
 * GET /api/navigation
 * GET /api/navigation?section=/guides
 * 
 * Returns the navigation structure for the documentation site.
 * 
 * RESPONSE:
 * {
 *   "topNav": [
 *     { "title": "Home", "path": "/", "isExternal": false },
 *     { "title": "Guides", "path": "/guides", "isExternal": false }
 *   ],
 *   "sidebar": [
 *     { "title": "Getting Started", "path": "/guides/getting-started", "type": "file", "order": 1 },
 *     { 
 *       "title": "Authentication", 
 *       "path": "/guides/authentication", 
 *       "type": "folder",
 *       "order": 2,
 *       "children": [...]
 *     }
 *   ]
 * }
 * 
 * CACHING:
 * - Response is cached until content changes (webhook/upload)
 * - Client should cache and refresh on navigation
 */

import { buildNavigation, getSidebarForSection } from '../utils/navigation'
import { logger } from '../utils/logger'
import { f0Config } from '../utils/f0-config'

export default defineEventHandler(async (event) => {
  const settings = f0Config()
  const query = getQuery(event)
  
  // Get optional section filter
  const section = query.section as string | undefined
  
  try {
    // Build full navigation
    const nav = await buildNavigation(settings.contentDir)
    
    // Convert sidebar Map to plain object for JSON serialization
    let sidebarData: Record<string, unknown>
    
    if (section) {
      // Return sidebar for specific section only
      const sidebarItems = await getSidebarForSection(settings.contentDir, section)
      sidebarData = { [section]: sidebarItems }
    } else {
      // Return all sidebars
      sidebarData = Object.fromEntries(nav.sidebar)
    }
    
    return {
      topNav: nav.topNav,
      sidebar: sidebarData,
    }
  } catch (error) {
    logger.error('Error building navigation', { error: error instanceof Error ? error.message : String(error) })
    
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      data: { message: 'Failed to load navigation' },
    })
  }
})
