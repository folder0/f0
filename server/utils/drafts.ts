/**
 * =============================================================================
 * F0 - DRAFTS
 * =============================================================================
 *
 * A draft (frontmatter draft: true, yes or on) is left out of every listing:
 * sidebar, sitemap, llms.txt, llms-index.txt, search, agent search, blog
 * index, tags and feeds. At its own URL it is still served (so authors can
 * preview it), marked noindex, unless F0_DRAFTS=404.
 *
 * F0_FLAGS=-hide-drafts restores the earlier behavior for one release: only
 * blog listings skipped drafts, and only for draft: true.
 */

import { isDraft } from './content-core'
import { changeEnabled } from './f0-config'

/** True when a page with this frontmatter must be left out of a listing. */
export function hiddenFromListings(data: Record<string, unknown>, listing: 'blog' | 'site'): boolean {
  if (changeEnabled('hide-drafts')) return isDraft(data)
  return listing === 'blog' && data.draft === true
}
