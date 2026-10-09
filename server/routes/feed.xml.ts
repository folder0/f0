/**
 * =============================================================================
 * F0 - RSS/ATOM FEED ROUTE
 * =============================================================================
 * 
 * GET /feed.xml
 * GET /feed.xml?path=/blog
 * 
 * Generates an RSS 2.0 feed for blog sections.
 * Uses the same post-scanning logic as the blog index API.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { logger } from '../utils/logger'
import { resolveContentSubdir } from '../utils/paths'
import { join, basename, extname } from 'path'
import {
  extractFrontmatter,
  generateExcerpt,
  extractDateFromFilename,
  isMarkdownFile,
} from '../utils/markdown'
import { resolveDirectoryConfig, defaultDirectoryConfig, defaultBlogPath } from '../utils/config'
import { f0Config } from '../utils/f0-config'
import { resolvePageTitle } from '../utils/content-core'
import { hiddenFromListings } from '../utils/drafts'

/**
 * Escape XML special characters
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const settings = f0Config()
  const query = getQuery(event)

  // Without ?path=, serve the site's blog (it used to be an empty feed of the
  // root folder on most sites)
  const requestedPath = query.path === undefined
    ? (defaultBlogPath(settings.contentDir) ?? undefined)
    : query.path

  // Confine ?path= to the content directory (rejects '..', hidden segments,
  // symlink escapes). A missing directory yields an empty feed, uncached.
  const target = await resolveContentSubdir(settings.contentDir, requestedPath)
  if (!target.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { message: 'Invalid path' } })
  }
  const dirPath = target.rel
  const dirConfig = target.exists
    ? resolveDirectoryConfig(settings.contentDir, dirPath)
    : defaultDirectoryConfig()
  const fullPath = target.abs

  const siteName = config.public.siteName || 'f0'
  const siteDescription = dirConfig.description || config.public.siteDescription || ''
  const feedTitle = dirConfig.title || siteName
  
  // Absolute links use the configured site URL; the request host only when
  // none is set
  const host = getRequestHost(event) || 'localhost:3000'
  const protocol = getRequestProtocol(event) || 'http'
  const baseUrl = (config.public.siteUrl || `${protocol}://${host}`).replace(/\/$/, '')

  // Collect posts
  interface FeedItem {
    title: string
    path: string
    date: string
    author: string
    excerpt: string
    tags: string[]
  }

  const items: FeedItem[] = []

  try {
    const entries = await readdir(fullPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile() || !isMarkdownFile(entry.name)) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'index.md' || entry.name === 'home.md' || entry.name === 'nav.md') continue

      const filePath = join(fullPath, entry.name)
      const rawContent = await readFile(filePath, 'utf-8')
      const { frontmatter, content: bodyContent } = extractFrontmatter(rawContent)

      if (hiddenFromListings(frontmatter, 'blog')) continue

      const cleanName = basename(entry.name, extname(entry.name))
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/^\d+-/, '')
      const title = resolvePageTitle({ data: frontmatter, body: bodyContent }, entry.name)

      // Resolve date
      let date: string
      if (frontmatter.date) {
        const d = frontmatter.date
        date = d instanceof Date ? d.toISOString().split('T')[0] : String(d)
      } else {
        const filenameDate = extractDateFromFilename(entry.name)
        if (filenameDate) {
          date = filenameDate
        } else {
          const stats = await stat(filePath)
          date = stats.mtime.toISOString().split('T')[0]
        }
      }

      const slug = cleanName
      const urlPath = dirPath ? `/${dirPath}/${slug}` : `/${slug}`

      items.push({
        title,
        path: urlPath,
        date,
        author: (frontmatter.author as string) || dirConfig.defaultAuthor || '',
        excerpt: (frontmatter.excerpt as string) || generateExcerpt(bodyContent),
        tags: Array.isArray(frontmatter.tags)
          ? (frontmatter.tags as string[]).map(t => String(t))
          : [],
      })
    }
  } catch (error) {
    logger.error('Error scanning for RSS feed posts', { error: error instanceof Error ? error.message : String(error) })
  }

  // Sort by date descending
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // Limit to 20 most recent
  const feedItems = items.slice(0, 20)

  // Build RSS XML
  const rssItems = feedItems.map(item => {
    const pubDate = new Date(item.date + 'T00:00:00Z').toUTCString()
    const link = `${baseUrl}${item.path}`
    const categories = item.tags.map(t => `      <category>${escapeXml(t)}</category>`).join('\n')

    return `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid>${escapeXml(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(item.excerpt)}</description>
${item.author ? `      <author>${escapeXml(item.author)}</author>` : ''}
${categories}
    </item>`
  }).join('\n')

  const feedLink = dirPath ? `${baseUrl}/feed.xml?path=/${dirPath}` : `${baseUrl}/feed.xml`
  const siteLink = dirPath ? `${baseUrl}/${dirPath}` : baseUrl

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(siteLink)}</link>
    <description>${escapeXml(siteDescription)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feedLink)}" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>`

  setHeader(event, 'Content-Type', 'application/rss+xml; charset=utf-8')
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return xml
})
