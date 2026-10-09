/**
 * =============================================================================
 * F0 - SEARCH INDEX (people, agents and MCP)
 * =============================================================================
 *
 * One walk of the content and one full-text index, shared by /api/search
 * (the search box, MCP) and /api/agents/search. Matches word prefixes and
 * small typos; title, headings and path count more than body text. Drafts,
 * hidden files and symlinks out of the content folder are never indexed.
 *
 * Rebuilt at most every 60 seconds, and immediately on a webhook push or
 * admin upload.
 */

import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'
import MiniSearch from 'minisearch'
import { getCachedContent } from './cache'
import { logger } from './logger'
import { isConfinedEntry } from './paths'
import { fileToUrlPath, readFrontmatter, resolvePageTitle, titleFromFileName } from './content-core'
import { hiddenFromListings } from './drafts'
import { markdownToPlainText } from './markdown'
import { onContentChange } from './invalidation'

export interface SearchDoc {
  id: number
  title: string
  path: string
  /** Title of the page's folder ("Guides", "Authentication"), "Home" for root pages */
  section: string
  /** Plain text of the page */
  content: string
  /** Markdown source, for agents that ask for full content */
  rawMarkdown: string
  /** H2 and H3 headings */
  headings: string[]
  wordCount: number
  hasCodeBlocks: boolean
  hasApiEndpoints: boolean
}

export interface SearchHit {
  doc: SearchDoc
  score: number
  /** Words in the document that matched (prefix and typo matches included) */
  terms: string[]
}

const INDEX_TTL_MS = 60_000

let cached: { contentDir: string, builtAt: number, docs: SearchDoc[], index: MiniSearch<SearchDoc> } | null = null
onContentChange('search-index', () => { cached = null })

function headingsOf(markdown: string): string[] {
  return [...markdown.matchAll(/^#{2,3}\s+(.+)$/gm)].map(match => match[1]!.trim())
}

async function collect(contentDir: string): Promise<SearchDoc[]> {
  const docs: SearchDoc[] = []

  async function scan(dir: string, section: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    }
    catch {
      logger.warn('Error scanning directory for search', { path: dir })
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue
      if (entry.name === 'assets' || entry.name === 'images' || entry.name === 'private' || entry.name === 'nav.md') continue
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await scan(fullPath, titleFromFileName(entry.name) || section)
        continue
      }
      if (!/\.(md|markdown|mdx)$/i.test(entry.name) || !(await isConfinedEntry(dir, entry, contentDir))) continue
      try {
        const rawMarkdown = await readFile(fullPath, 'utf-8')
        let title: string
        let content: string
        let frontmatter: Record<string, unknown>
        try {
          const page = await getCachedContent(fullPath)
          title = page.title
          content = page.plainText
          frontmatter = page.frontmatter
        }
        catch {
          const doc = readFrontmatter(rawMarkdown)
          title = resolvePageTitle(doc, entry.name)
          content = markdownToPlainText(rawMarkdown)
          frontmatter = doc.data
        }
        if (hiddenFromListings(frontmatter, 'site')) continue

        const body = readFrontmatter(rawMarkdown).body
        docs.push({
          id: docs.length,
          title,
          path: fileToUrlPath(relative(contentDir, fullPath)),
          section: section || 'Home',
          content,
          rawMarkdown,
          headings: headingsOf(body),
          wordCount: content.split(/\s+/).filter(Boolean).length,
          hasCodeBlocks: /```[\s\S]*?```/.test(body),
          hasApiEndpoints: /:::api\s+(GET|POST|PUT|PATCH|DELETE)/.test(body) || /^(GET|POST|PUT|PATCH|DELETE)\s+\//m.test(body),
        })
      }
      catch {
        logger.warn('Error reading file for search', { path: fullPath })
      }
    }
  }

  await scan(contentDir, '')
  return docs
}

async function getIndex(contentDir: string) {
  if (cached && cached.contentDir === contentDir && Date.now() - cached.builtAt < INDEX_TTL_MS) return cached
  const docs = await collect(contentDir)
  const index = new MiniSearch<SearchDoc>({
    fields: ['title', 'headingText', 'path', 'section', 'content'],
    extractField: (doc, field) => (field === 'headingText' ? doc.headings.join(' ') : String((doc as unknown as Record<string, unknown>)[field] ?? '')),
    // Split paths and identifiers on separators as well as spaces
    tokenize: text => text.split(/[\s\p{P}\p{S}]+/u).filter(Boolean),
  })
  index.addAll(docs)
  cached = { contentDir, builtAt: Date.now(), docs, index }
  return cached
}

/** Search the site. Words shorter than two letters are ignored. */
export async function searchSite(contentDir: string, query: string, options: { limit?: number, section?: string } = {}): Promise<SearchHit[]> {
  const words = query.toLowerCase().split(/\s+/).filter(word => word.length > 1)
  if (words.length === 0) return []
  const { docs, index } = await getIndex(contentDir)
  const section = options.section?.toLowerCase()
  const hits = index.search(words.join(' '), {
    prefix: true,
    fuzzy: term => (term.length > 4 ? 0.2 : false),
    boost: { title: 4, headingText: 2.5, path: 2, section: 1.5 },
    filter: section ? result => docs[result.id as number]?.section.toLowerCase() === section : undefined,
  })
  return hits.slice(0, options.limit ?? 10).flatMap((hit) => {
    const doc = docs[hit.id as number]
    return doc ? [{ doc, score: hit.score, terms: [...new Set([...hit.terms, ...words])] }] : []
  })
}

/** An excerpt of `content` around the earliest matching word. */
export function excerptAround(content: string, terms: string[], length = 150): string {
  const lower = content.toLowerCase()
  let first = -1
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase())
    if (index !== -1 && (first === -1 || index < first)) first = index
  }
  if (first === -1) return content.slice(0, length) + (content.length > length ? '...' : '')
  const start = Math.max(0, first - 50)
  const end = Math.min(content.length, first + length - 50)
  return (start > 0 ? '...' : '') + content.slice(start, end) + (end < content.length ? '...' : '')
}
