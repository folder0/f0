/**
 * =============================================================================
 * F0 - FEEDS (RSS 2.0, Atom 1.0, JSON Feed 1.1)
 * =============================================================================
 *
 * One blog folder's 20 newest posts, with their full rendered content (links
 * and images made absolute for feed readers):
 *   /feed.xml   RSS 2.0 (content:encoded)
 *   /feed.atom  Atom 1.0
 *   /feed.json  JSON Feed 1.1
 * All three take ?path=/blog; without it they serve the site's blog. Item ids
 * are the post URLs, as /feed.xml has always used.
 */

import type { H3Event } from 'h3'
import { getCachedContent } from './cache'
import { defaultBlogPath, defaultDirectoryConfig, resolveDirectoryConfig, type DirectoryConfig } from './config'
import { f0Config } from './f0-config'
import { listBlogPostEntries, type BlogPostSummary } from './blog'
import { resolveContentSubdir } from './paths'
import { logger } from './logger'

export type FeedFormat = 'rss' | 'atom' | 'json'

const FEED_FILES: Record<FeedFormat, string> = { rss: 'feed.xml', atom: 'feed.atom', json: 'feed.json' }
const MAX_ITEMS = 20

interface FeedItem extends BlogPostSummary {
  url: string
  html: string
}

interface Feed {
  title: string
  description: string
  siteUrl: string
  feedUrl: (format: FeedFormat) => string
  items: FeedItem[]
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Make root-relative links and image sources absolute (feed readers have no base URL). */
function absolutize(html: string, baseUrl: string): string {
  return html
    .replace(/\b(src|href|poster)="\/(?!\/)/g, `$1="${baseUrl}/`)
    .replace(/\bsrcset="([^"]*)"/g, (_match, set: string) =>
      `srcset="${set.replace(/(^|,\s*)\/(?!\/)/g, `$1${baseUrl}/`)}"`)
}

/** RFC 3339 date-time for a YYYY-MM-DD (or full ISO) date. */
function isoDate(date: string): string {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00Z` : date)
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString()
}

/** Collect the feed for a request (?path=), or throw 400 for an invalid path. */
export async function loadFeed(event: H3Event): Promise<Feed> {
  const config = useRuntimeConfig()
  const settings = f0Config()
  const query = getQuery(event)

  // Without ?path=, serve the site's blog (it used to be an empty feed of the
  // root folder on most sites)
  const requestedPath = query.path === undefined
    ? (defaultBlogPath(settings.contentDir) ?? undefined)
    : query.path

  // Confine ?path= to the content directory (rejects '..', hidden segments,
  // symlink escapes). A missing directory yields an empty feed.
  const target = await resolveContentSubdir(settings.contentDir, requestedPath)
  if (!target.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { message: 'Invalid path' } })
  }
  const dirConfig: DirectoryConfig = target.exists
    ? resolveDirectoryConfig(settings.contentDir, target.dir)
    : defaultDirectoryConfig()

  // Absolute links use the configured site URL; the request host only when
  // none is set
  const host = getRequestHost(event) || 'localhost:3000'
  const protocol = getRequestProtocol(event) || 'http'
  const baseUrl = (config.public.siteUrl || `${protocol}://${host}`).replace(/\/$/, '')

  const urlBase = target.rel ? `/${target.rel}` : ''
  const entries = target.exists ? await listBlogPostEntries(target.abs, urlBase, dirConfig) : []

  // Newest first (pinning is for the blog page, not for feeds)
  entries.sort((a, b) => new Date(b.post.date).getTime() - new Date(a.post.date).getTime())

  const items: FeedItem[] = []
  for (const { post, file } of entries.slice(0, MAX_ITEMS)) {
    let html = ''
    try {
      html = absolutize((await getCachedContent(file)).html, baseUrl)
    }
    catch (error) {
      logger.warn('Feed item without content', { path: post.path, error: error instanceof Error ? error.message : String(error) })
    }
    items.push({ ...post, url: `${baseUrl}${post.path}`, html })
  }

  const siteName = config.public.siteName || 'f0'
  const pathQuery = target.rel ? `?path=/${encodeURI(target.rel)}` : ''
  return {
    title: dirConfig.title || siteName,
    description: dirConfig.description || config.public.siteDescription || '',
    siteUrl: target.rel ? `${baseUrl}/${target.rel}` : baseUrl,
    feedUrl: format => `${baseUrl}/${FEED_FILES[format]}${pathQuery}`,
    items,
  }
}

export function renderRss(feed: Feed): string {
  const items = feed.items.map(item => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <guid>${escapeXml(item.url)}</guid>
      <pubDate>${new Date(isoDate(item.date)).toUTCString()}</pubDate>
      <description>${escapeXml(item.excerpt)}</description>
${item.html ? `      <content:encoded>${escapeXml(item.html)}</content:encoded>\n` : ''}${item.author ? `      <author>${escapeXml(item.author)}</author>\n` : ''}${item.tags.map(tag => `      <category>${escapeXml(tag)}</category>\n`).join('')}    </item>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(feed.title)}</title>
    <link>${escapeXml(feed.siteUrl)}</link>
    <description>${escapeXml(feed.description)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(feed.feedUrl('rss'))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`
}

export function renderAtom(feed: Feed): string {
  const updated = feed.items[0] ? isoDate(feed.items[0].date) : new Date(0).toISOString()
  const entries = feed.items.map(item => `  <entry>
    <title>${escapeXml(item.title)}</title>
    <link rel="alternate" type="text/html" href="${escapeXml(item.url)}"/>
    <id>${escapeXml(item.url)}</id>
    <published>${isoDate(item.date)}</published>
    <updated>${isoDate(item.date)}</updated>
${item.author ? `    <author><name>${escapeXml(item.author)}</name></author>\n` : ''}${item.tags.map(tag => `    <category term="${escapeXml(tag)}"/>\n`).join('')}    <summary>${escapeXml(item.excerpt)}</summary>
${item.html ? `    <content type="html">${escapeXml(item.html)}</content>\n` : ''}  </entry>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${escapeXml(feed.title)}</title>
  <subtitle>${escapeXml(feed.description)}</subtitle>
  <link rel="alternate" type="text/html" href="${escapeXml(feed.siteUrl)}"/>
  <link rel="self" type="application/atom+xml" href="${escapeXml(feed.feedUrl('atom'))}"/>
  <id>${escapeXml(feed.feedUrl('atom'))}</id>
  <updated>${updated}</updated>
${entries}
</feed>`
}

export function renderJsonFeed(feed: Feed): string {
  return JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: feed.title,
    description: feed.description || undefined,
    home_page_url: feed.siteUrl,
    feed_url: feed.feedUrl('json'),
    items: feed.items.map(item => ({
      id: item.url,
      url: item.url,
      title: item.title,
      summary: item.excerpt,
      content_html: item.html || undefined,
      date_published: isoDate(item.date),
      authors: item.author ? [{ name: item.author }] : undefined,
      tags: item.tags.length ? item.tags : undefined,
      image: item.coverImage ? (item.coverImage.startsWith('/') ? `${feed.siteUrl.replace(/^(https?:\/\/[^/]+).*$/, '$1')}${item.coverImage}` : item.coverImage) : undefined,
    })),
  }, null, 2)
}

const CONTENT_TYPES: Record<FeedFormat, string> = {
  rss: 'application/rss+xml; charset=utf-8',
  atom: 'application/atom+xml; charset=utf-8',
  json: 'application/feed+json; charset=utf-8',
}

/** Handle a feed request in the given format. */
export async function sendFeed(event: H3Event, format: FeedFormat): Promise<string> {
  const feed = await loadFeed(event)
  setHeader(event, 'Content-Type', CONTENT_TYPES[format])
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  if (format === 'atom') return renderAtom(feed)
  if (format === 'json') return renderJsonFeed(feed)
  return renderRss(feed)
}
