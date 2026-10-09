/**
 * =============================================================================
 * F0 - BLOG TAGS API
 * =============================================================================
 * 
 * GET /api/blog/tags?path=/blog
 * 
 * Returns all tags used across posts in a blog directory with counts.
 * Lightweight endpoint that reuses post-scanning logic.
 */

import { readdir, readFile } from 'fs/promises'
import { join, extname, basename } from 'path'
import { logger } from '../../utils/logger'
import { resolveContentSubdir } from '../../utils/paths'
import { extractFrontmatter, isMarkdownFile } from '../../utils/markdown'

interface TagInfo {
  name: string
  count: number
  posts: string[]
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const query = getQuery(event)

  // Confine ?path= to the content directory; a missing directory lists no tags.
  const target = await resolveContentSubdir(config.contentDir, query.path)
  if (!target.ok) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', data: { message: 'Invalid path' } })
  }
  if (!target.exists) {
    return { tags: [] }
  }
  const dirPath = target.rel
  const fullPath = target.abs

  const tagMap = new Map<string, { count: number; posts: string[] }>()

  try {
    const entries = await readdir(fullPath, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile() || !isMarkdownFile(entry.name)) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'index.md' || entry.name === 'home.md' || entry.name === 'nav.md') continue

      const filePath = join(fullPath, entry.name)
      const rawContent = await readFile(filePath, 'utf-8')
      const { frontmatter } = extractFrontmatter(rawContent)

      if (frontmatter.draft === true) continue

      const tags = Array.isArray(frontmatter.tags)
        ? (frontmatter.tags as string[]).map(t => String(t).toLowerCase())
        : []

      const slug = basename(entry.name, extname(entry.name))
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/^\d+-/, '')
      const postPath = dirPath ? `/${dirPath}/${slug}` : `/${slug}`

      for (const tag of tags) {
        const existing = tagMap.get(tag) || { count: 0, posts: [] }
        existing.count++
        existing.posts.push(postPath)
        tagMap.set(tag, existing)
      }
    }
  } catch (error) {
    logger.warn('Error scanning blog tags', { path: fullPath })
  }

  const tags: TagInfo[] = Array.from(tagMap.entries())
    .map(([name, data]) => ({ name, count: data.count, posts: data.posts }))
    .sort((a, b) => b.count - a.count)

  return { tags }
})
