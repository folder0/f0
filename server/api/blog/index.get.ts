/**
 * =============================================================================
 * F0 - BLOG INDEX API
 * =============================================================================
 * 
 * GET /api/blog?path=/blog&page=1&tag=engineering
 * 
 * Returns a paginated list of blog posts for a given directory.
 * Scans the directory for .md files, parses frontmatter only (fast),
 * and returns post summaries sorted by pinned then date descending.
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-ARCH-FILESYSTEM-SOT-001: Posts read from filesystem
 * - C-OPS-ZERO-CONFIG-DEFAULT-008: Works with default settings
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, basename, extname } from 'path'
import {
  extractFrontmatter,
  generateExcerpt,
  calculateReadingTime,
  extractDateFromFilename,
  isMarkdownFile,
} from '../../utils/markdown'
import { resolveDirectoryConfig, defaultDirectoryConfig, type DirectoryConfig } from '../../utils/config'
import { resolveContentSubdir } from '../../utils/paths'
import { logger } from '../../utils/logger'
import { f0Config } from '../../utils/f0-config'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface BlogPostSummary {
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

interface BlogIndexResponse {
  config: DirectoryConfig
  posts: BlogPostSummary[]
  pagination: {
    currentPage: number
    totalPages: number
    totalPosts: number
    postsPerPage: number
  }
  tags: { name: string; count: number }[]
}

// =============================================================================
// POST SCANNER
// =============================================================================

/**
 * Scan a directory for blog posts and parse their frontmatter
 */
async function scanBlogPosts(
  contentDir: string,
  dirPath: string,
  config: DirectoryConfig
): Promise<BlogPostSummary[]> {
  const fullPath = dirPath ? join(contentDir, dirPath) : contentDir
  const posts: BlogPostSummary[] = []

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

      // Skip drafts
      if (frontmatter.draft === true) continue

      // Resolve title
      const cleanName = basename(entry.name, extname(entry.name))
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/^\d+-/, '')
      const titleFromFilename = cleanName
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')

      // Extract first H1 as fallback title
      const h1Match = bodyContent.match(/^#\s+(.+)$/m)
      const title = (frontmatter.title as string)
        || (h1Match ? h1Match[1].trim() : null)
        || titleFromFilename

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
      const urlPath = dirPath ? `/${dirPath}/${slug}` : `/${slug}`

      // Resolve other fields
      const author = (frontmatter.author as string) || config.defaultAuthor || ''
      const tags = Array.isArray(frontmatter.tags)
        ? (frontmatter.tags as string[]).map(t => String(t).toLowerCase())
        : []
      const excerpt = (frontmatter.excerpt as string) || generateExcerpt(bodyContent)
      const coverImage = (frontmatter.cover_image as string) || undefined
      const pinned = frontmatter.pinned === true
      const readingTime = calculateReadingTime(rawContent)

      posts.push({
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
      })
    }
  } catch (error) {
    logger.warn('Error scanning blog directory', { path: fullPath })
  }

  // Sort: pinned first (by date desc), then all others by date desc
  posts.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  return posts
}

// =============================================================================
// HANDLER
// =============================================================================

export default defineEventHandler(async (event): Promise<BlogIndexResponse> => {
  const settings = f0Config()
  const query = getQuery(event)

  // Confine ?path= to the content directory (rejects '..', hidden segments,
  // symlink escapes). A well-formed path that does not exist keeps returning
  // an empty listing, without being cached.
  const target = await resolveContentSubdir(settings.contentDir, query.path)
  if (!target.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { message: 'Invalid path' } })
  }
  const dirPath = target.rel
  const page = Math.max(1, parseInt(query.page as string) || 1)
  const tagFilter = (query.tag as string)?.toLowerCase() || ''

  // Get directory config
  const dirConfig = target.exists
    ? resolveDirectoryConfig(settings.contentDir, dirPath)
    : defaultDirectoryConfig()

  // Scan posts
  let posts = target.exists ? await scanBlogPosts(settings.contentDir, dirPath, dirConfig) : []

  // Aggregate tags (before filtering)
  const tagMap = new Map<string, number>()
  for (const post of posts) {
    for (const tag of post.tags) {
      tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
    }
  }
  const tags = Array.from(tagMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)

  // Apply tag filter
  if (tagFilter) {
    posts = posts.filter(p => p.tags.includes(tagFilter))
  }

  // Paginate
  const postsPerPage = dirConfig.postsPerPage
  const totalPosts = posts.length
  const totalPages = Math.max(1, Math.ceil(totalPosts / postsPerPage))
  const startIndex = (page - 1) * postsPerPage
  const paginatedPosts = posts.slice(startIndex, startIndex + postsPerPage)

  return {
    config: dirConfig,
    posts: paginatedPosts,
    pagination: {
      currentPage: page,
      totalPages,
      totalPosts,
      postsPerPage,
    },
    tags,
  }
})
