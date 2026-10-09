/**
 * =============================================================================
 * F0 - PARTIALS (Markdown in named places, no fork needed)
 * =============================================================================
 *
 * A Markdown file in a _partials/ folder renders into a fixed place in the
 * page, through the same pipeline as pages (sanitized, images resolved):
 *
 *   _partials/announcement.md  banner above every page's content
 *   _partials/footer.md        site footer, above footer_text and links
 *   _partials/doc-footer.md    after every docs page (feedback prompt, ...)
 *   _partials/post-footer.md   after every blog post (newsletter, author bio)
 *
 * announcement and footer come from the content root. doc-footer and
 * post-footer use the nearest _partials/ folder above the page, so a blog
 * folder can have its own post footer. _partials/ is never a page itself.
 */

import { existsSync } from 'fs'
import { dirname, join, relative, resolve, sep } from 'path'
import { getCachedContent } from './cache'
import { logger } from './logger'

export const SITE_PARTIALS = ['announcement', 'footer'] as const
export const PAGE_PARTIALS = ['doc-footer', 'post-footer'] as const
export type PartialName = typeof SITE_PARTIALS[number] | typeof PAGE_PARTIALS[number]

async function render(file: string): Promise<string> {
  try {
    return (await getCachedContent(file)).html
  }
  catch (error) {
    logger.warn('Partial could not be rendered', { file, error: error instanceof Error ? error.message : String(error) })
    return ''
  }
}

/** A site-wide partial from the content root, as HTML ('' when absent). */
export async function sitePartial(contentDir: string, name: typeof SITE_PARTIALS[number]): Promise<string> {
  const file = join(resolve(contentDir), '_partials', `${name}.md`)
  return existsSync(file) ? render(file) : ''
}

/**
 * A page partial: the nearest _partials/<name>.md in the page's folder or any
 * folder above it, as HTML ('' when there is none).
 */
export async function pagePartial(contentDir: string, pageFile: string, name: typeof PAGE_PARTIALS[number]): Promise<string> {
  const root = resolve(contentDir)
  const rel = relative(root, dirname(resolve(pageFile)))
  if (rel.startsWith('..')) return ''
  const segments = rel.split(sep).filter(Boolean)
  for (let i = segments.length; i >= 0; i--) {
    const file = join(root, ...segments.slice(0, i), '_partials', `${name}.md`)
    if (existsSync(file)) return render(file)
  }
  return ''
}
