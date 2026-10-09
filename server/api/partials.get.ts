/**
 * =============================================================================
 * F0 - SITE PARTIALS
 * =============================================================================
 *
 * GET /api/partials → { announcement: "<p>...</p>", footer: "" }
 *
 * Rendered HTML of content/_partials/announcement.md and footer.md ('' when
 * absent), for the layout. See server/utils/partials.ts.
 */

import { f0Config } from '../utils/f0-config'
import { SITE_PARTIALS, sitePartial } from '../utils/partials'

export default defineEventHandler(async () => {
  const { contentDir } = f0Config()
  const entries = await Promise.all(SITE_PARTIALS.map(async name => [name, await sitePartial(contentDir, name)] as const))
  return Object.fromEntries(entries) as Record<typeof SITE_PARTIALS[number], string>
})
