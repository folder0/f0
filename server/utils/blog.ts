/**
 * =============================================================================
 * F0 - BLOG POSTS
 * =============================================================================
 *
 * The posts of one blog folder, newest first (pinned posts on top), shared by
 * the blog index API and post pages (previous/next post).
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import {
  extractFrontmatter,
  generateExcerpt,
  calculateReadingTime,
  extractDateFromFilename,
  isMarkdownFile,
} from './markdown'
import type { DirectoryConfig } from './config'
import { logger } from './logger'
import { resolveAssetUrl, resolvePageTitle } from './content-core'
import { hiddenFromListings } from './drafts'
import { onContentChange } from './invalidation'

export interface BlogPostSummary {
  title: string
  slug: string
  path: string
  date: string
  author: string
  tags: string[]
  excerpt: string
  coverImage?: string
  pinned: boolean
  readingTime: number
  draft: boolean
}

// =============================================================================
// POST SCANNER
// fullPath: the folder on disk; urlBase: the URL the posts live under ('/blog')
// =============================================================================

/**
 * Scan a directory for blog posts and parse their frontmatter
 */
export interface BlogPostEntry {
  post: BlogPostSummary
  /** Absolute path of the post's file (server-side only, never sent) */
  file: string
}

/** Posts of a blog folder as summaries for the API. */
export async function listBlogPosts(fullPath: string, urlBase: string, config: DirectoryConfig): Promise<BlogPostSummary[]> {
  return (await listBlogPostEntries(fullPath, urlBase, config)).map(entry => entry.post)
}

// Listings are cached per folder and URL base, and reused while every file in
// the folder keeps its name, size and mtime (a post page asks for its
// neighbours on every view; this avoids re-reading the whole folder)
const listingCache = new Map<string, { signature: string, entries: BlogPostEntry[] }>()
const LISTING_CACHE_MAX = 32
onContentChange('blog-listings', () => listingCache.clear())

async function folderSignature(fullPath: string): Promise<string> {
  const names = (await readdir(fullPath).catch(() => [] as string[])).sort()
  const parts = await Promise.all(names.map(async name => {
    const stats = await stat(join(fullPath, name)).catch(() => null)
    return `${name}:${stats?.mtimeMs ?? 0}:${stats?.size ?? 0}`
  }))
  return parts.join('|')
}

/** Posts of a blog folder with their files, pinned first, then newest first. */
export async function listBlogPostEntries(
  fullPath: string,
  urlBase: string,
  config: DirectoryConfig
): Promise<BlogPostEntry[]> {
  const key = `${fullPath}\0${urlBase}\0${config.defaultAuthor}`
  const signature = await folderSignature(fullPath)
  const cached = listingCache.get(key)
  if (cached && cached.signature === signature) {
    return cached.entries.map(entry => ({ file: entry.file, post: { ...entry.post, tags: [...entry.post.tags] } }))
  }
  const entries = await scanBlogFolder(fullPath, urlBase, config)
  listingCache.delete(key)
  listingCache.set(key, { signature, entries })
  while (listingCache.size > LISTING_CACHE_MAX) {
    const oldest = listingCache.keys().next().value
    if (oldest === undefined) break
    listingCache.delete(oldest)
  }
  return entries.map(entry => ({ file: entry.file, post: { ...entry.post, tags: [...entry.post.tags] } }))
}

async function scanBlogFolder(
  fullPath: string,
  urlBase: string,
  config: DirectoryConfig
): Promise<BlogPostEntry[]> {
  const base = urlBase.replace(/\/+$/, '')
  const posts: BlogPostEntry[] = []

  try {
    const entries = await readdir(fullPath, { withFileTypes: true })

    for (const entry of entries) {
      // Skip non-markdown, hidden, special files
      if (!entry.isFile()) continue
      if (!isMarkdownFile(entry.name)) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'index.md' || entry.name === 'home.md' || entry.name === 'nav.md') continue

      const filePath = join(fullPath, entry.name)
      const rawContent = await readFile(filePath, 'utf-8')
      const { frontmatter, content: bodyContent } = extractFrontmatter(rawContent)

      // Skip drafts (draft: true, yes or on)
      if (hiddenFromListings(frontmatter, 'blog')) continue

      // Resolve title
      const cleanName = basename(entry.name, extname(entry.name))
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/^\d+-/, '')
      // Same title rule as the post page: frontmatter title, H1, file name
      const title = resolvePageTitle({ data: frontmatter, body: bodyContent }, entry.name)

      // Resolve date: frontmatter > filename > mtime
      let date: string
      if (frontmatter.date) {
        // Handle Date objects or strings
        const d = frontmatter.date
        if (d instanceof Date) {
          date = d.toISOString().split('T')[0]
        } else {
          date = String(d)
        }
      } else {
        const filenameDate = extractDateFromFilename(entry.name)
        if (filenameDate) {
          date = filenameDate
        } else {
          const stats = await stat(filePath)
          date = stats.mtime.toISOString().split('T')[0]
        }
      }

      // Build slug (URL path segment)
      const slug = cleanName.replace(/^\d{4}-\d{2}-\d{2}-/, '')
      const urlPath = `${base}/${slug}`

      // Resolve other fields
      const author = (frontmatter.author as string) || config.defaultAuthor || ''
      const tags = Array.isArray(frontmatter.tags)
        ? (frontmatter.tags as string[]).map(t => String(t).toLowerCase())
        : []
      const excerpt = (frontmatter.excerpt as string) || generateExcerpt(bodyContent)
      const coverImage = typeof frontmatter.cover_image === 'string' && frontmatter.cover_image.trim()
        ? resolveAssetUrl(frontmatter.cover_image)
        : undefined
      const pinned = frontmatter.pinned === true
      const readingTime = calculateReadingTime(rawContent)

      posts.push({
        file: filePath,
        post: {
          title,
          slug,
          path: urlPath,
          date,
          author,
          tags,
          excerpt,
          coverImage,
          pinned,
          readingTime,
          draft: false,
        },
      })
    }
  } catch (error) {
    logger.warn('Error scanning blog directory', { path: fullPath })
  }

  // Sort: pinned first (by date desc), then all others by date desc
  posts.sort(({ post: a }, { post: b }) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  return posts
}

