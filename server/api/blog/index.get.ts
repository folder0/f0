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

import { resolveDirectoryConfig, defaultDirectoryConfig, type DirectoryConfig } from '../../utils/config'
import { resolveContentSubdir } from '../../utils/paths'
import { f0Config } from '../../utils/f0-config'
import { listBlogPosts, type BlogPostSummary } from '../../utils/blog'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

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

  // Get directory config (of the folder the path resolved to: ?path=/blog
  // may be content/02-blog)
  const dirConfig = target.exists
    ? resolveDirectoryConfig(settings.contentDir, target.dir)
    : defaultDirectoryConfig()

  // Scan posts
  let posts = target.exists ? await listBlogPosts(target.abs, dirPath ? `/${dirPath}` : '', dirConfig) : []

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
