/**
 * =============================================================================
 * F0 - MARKDOWN PARSER
 * =============================================================================
 * 
 * This module handles all Markdown-to-HTML conversion using the unified/remark
 * /rehype ecosystem. It's the core rendering engine that powers the "tri-brid"
 * output: Human UI, SEO HTML, and LLM text.
 * 
 * PROCESSING PIPELINE:
 * 1. Parse Markdown (remark-parse)
 * 2. Support GitHub Flavored Markdown (remark-gfm) - tables, task lists, etc.
 * 3. Custom plugins (YouTube embeds, callouts)
 * 4. Convert to HTML AST (remark-rehype)
 * 5. Add heading slugs for linking (rehype-slug)
 * 6. Syntax highlighting for code (rehype-highlight)
 * 7. Stringify to HTML (rehype-stringify)
 * 
 * CONSTRAINT COMPLIANCE:
 * - C-AI-TRIBRID-CONSISTENCY-003: Same source renders consistently
 * - C-AI-LLMS-NO-UI-NOISE-004: LLM output strips all presentation
 * 
 * CUSTOM SYNTAX SUPPORTED:
 * - ::youtube[Title]{id=VIDEO_ID}  → Responsive YouTube embed
 * - :::info / :::warning / :::error / :::success → Callout boxes
 * - Standard GFM: tables, task lists, strikethrough, autolinks
 */

import { unified, type Processor } from 'unified'
import { firstHeading, readFrontmatter, resolveAssetUrl, stringField, titleFromFileName } from './content-core'
import type { VFile } from 'vfile'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import rehypeRaw from 'rehype-raw'
import { visit } from 'unist-util-visit'
import type { Root, Text, Paragraph } from 'mdast'
import type { Root as HastRoot, Element } from 'hast'
import { logger } from './logger'
import { rehypeDropTableWhitespace, rehypeRestoreTableWhitespace, rehypeStripDangerous, stabilizeHtml } from './sanitize'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Frontmatter metadata extracted from Markdown files
 */
export interface MarkdownFrontmatter {
  title?: string
  description?: string
  order?: number
  draft?: boolean
  // Allow arbitrary additional fields
  [key: string]: unknown
}

/**
 * Result of parsing a Markdown file
 */
export interface ParsedMarkdown {
  // Rendered HTML content
  html: string
  
  // Extracted frontmatter
  frontmatter: MarkdownFrontmatter
  
  // Table of contents (headings)
  toc: TocItem[]
  
  // Plain text version (for LLM output)
  plainText: string
  
  // First H1 heading (fallback title)
  title: string
}

/**
 * Table of contents entry
 */
export interface TocItem {
  id: string        // Slug for linking (e.g., "getting-started")
  text: string      // Display text
  level: number     // Heading level (2 or 3)
  children: TocItem[]
}

// =============================================================================
// CUSTOM REMARK PLUGINS
// =============================================================================

/**
 * Remark plugin to handle YouTube embed syntax
 * 
 * Syntax: ::youtube[Video Title]{id=dQw4w9WgXcQ}
 * 
 * This transforms the directive into a special node that gets converted
 * to a responsive YouTube iframe in HTML, or a text reference for LLMs.
 */
function remarkYouTube() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || index === undefined) return
      
      // Check if paragraph contains only text matching our YouTube syntax
      if (node.children.length !== 1 || node.children[0].type !== 'text') return
      
      const text = (node.children[0] as Text).value
      const match = text.match(/^::youtube\[([^\]]*)\]\{id=([^}]+)\}$/)
      
      if (!match) return
      
      const [, title, videoId] = match
      
      // Replace the paragraph with our custom YouTube node
      // @ts-expect-error - Adding custom node type
      parent.children[index] = {
        type: 'youtube',
        data: {
          hName: 'div',
          hProperties: {
            className: ['youtube-embed'],
            'data-video-id': videoId,
            'data-video-title': title || 'YouTube Video',
          },
          hChildren: [
            {
              type: 'element',
              tagName: 'iframe',
              properties: {
                src: `https://www.youtube.com/embed/${videoId}`,
                title: title || 'YouTube Video',
                frameBorder: '0',
                allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
                allowFullScreen: true,
              },
              children: [],
            },
          ],
        },
      }
    })
  }
}

/**
 * Pre-process markdown to convert callout syntax to HTML
 * This runs BEFORE remark parsing to ensure callouts work with any content
 * 
 * Syntax:
 * :::info
 * Content with **bold**, `code`, etc.
 * Multiple lines supported.
 * :::
 * 
 * Supported types: info, warning, error, success, tip, note, danger
 */
// =============================================================================
// CODE MASKING
// =============================================================================

interface FencedBlock {
  /** The block exactly as written, fences included */
  raw: string
  /** The lines between the fences */
  body: string
}

const MASK_TOKEN = /\uE000(F|C)(\d+)\uE001/g

/**
 * Replace fenced code blocks (``` and ~~~, any indentation, unclosed blocks
 * running to the end) with one placeholder line each, so text rules (callout
 * and embed syntax, plaintext conversion) never rewrite code. A page that
 * documents `:::info` inside a code fence keeps it as code.
 */
function maskFencedCode(markdown: string): { text: string, blocks: FencedBlock[] } {
  const blocks: FencedBlock[] = []
  const out: string[] = []
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^[ \t]*(`{3,}|~{3,})(.*)$/)
    if (!open || (open[1][0] === '`' && open[2].includes('`'))) {
      out.push(lines[i])
      continue
    }
    const fence = open[1]
    let end = i + 1
    while (end < lines.length) {
      const close = lines[end].match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) break
      end++
    }
    const last = Math.min(end, lines.length - 1)
    blocks.push({ raw: lines.slice(i, last + 1).join('\n'), body: lines.slice(i + 1, end).join('\n') })
    out.push(`\uE000F${blocks.length - 1}\uE001`)
    i = last
  }
  return { text: out.join('\n'), blocks }
}

/** Put masked fenced blocks back exactly as written. */
function unmaskFencedCode(text: string, blocks: FencedBlock[]): string {
  return text.replace(MASK_TOKEN, (token, kind, index) => (kind === 'F' ? blocks[Number(index)]?.raw ?? token : token))
}

/**
 * Apply the directive preprocessors (callouts, embeds, :::api) to everything
 * except fenced code.
 */
function preprocessDirectives(markdown: string): string {
  const { text, blocks } = maskFencedCode(markdown)
  return unmaskFencedCode(preprocessApiBlocks(preprocessEmbeds(preprocessComponents(preprocessCallouts(text)))), blocks)
}

// =============================================================================
// AUTHORING COMPONENTS (:::tabs, :::steps, :::cards)
// =============================================================================

// A component block whose body contains no other component opening, so
// nested blocks are converted innermost first
const COMPONENT_BLOCK = /^:::(tabs|steps|cards)[ \t]*\n((?:(?!^:::(?:tabs|steps|cards)\b)[\s\S])*?)\n:::[ \t]*$/gm

/**
 * Convert authoring components to HTML blocks whose content stays Markdown:
 *
 *   :::tabs                 :::steps              :::cards
 *   @tab npm                ### Install           - [Guides](/guides) — Start here
 *   ```bash ... ```         Run the installer.    - [API](/api) — Endpoints
 *   @tab pnpm               ### Configure         :::
 *   ...                     ...
 *   :::                     :::
 *
 * Tabs work without JavaScript (all panels shown, each labelled); the page
 * script turns them into a tab bar. Steps number each ### heading. Cards lay
 * out a list of links as a grid.
 */
function preprocessComponents(markdown: string): string {
  let text = markdown
  for (let pass = 0; pass < 10; pass++) {
    const next = text.replace(COMPONENT_BLOCK, (_match, kind: string, body: string) => {
      if (kind !== 'tabs') {
        return `<div class="f0-${kind}">\n\n${body.trim()}\n\n</div>`
      }
      const panels = body.split(/^@tab[ \t]+(.+?)[ \t]*$/m)
      const intro = panels.shift()?.trim() ?? ''
      const tabs: string[] = []
      for (let i = 0; i < panels.length; i += 2) {
        tabs.push(`<div class="f0-tab" data-tab-label="${escapeHtml(panels[i])}">\n\n${(panels[i + 1] ?? '').trim()}\n\n</div>`)
      }
      return `${intro ? `${intro}\n\n` : ''}<div class="f0-tabs">\n\n${tabs.join('\n\n')}\n\n</div>`
    })
    if (next === text) break
    text = next
  }
  return text
}

function preprocessCallouts(markdown: string): string {
  // Match callout blocks: :::type followed by content followed by :::
  // Use a regex that captures the type and content
  // [ \t]* rather than \s*: \s* also consumed the blank line after the closing
  // :::, which glued the next paragraph (often an image) into the raw <div>
  // block, where it rendered as literal Markdown text
  const calloutRegex = /^:::(info|warning|error|success|tip|note|danger)[ \t]*\n([\s\S]*?)\n:::[ \t]*$/gm
  
  return markdown.replace(calloutRegex, (match, type, content) => {
    // Normalize the type for CSS class
    const normalizedType = type.toLowerCase()
    
    // Create a placeholder that will survive markdown parsing
    // We use a special HTML comment format that we'll convert back later
    const trimmedContent = content.trim()
    
    // Return HTML div that remark will pass through
    return `<div class="callout callout-${normalizedType}">\n\n${trimmedContent}\n\n</div>`
  })
}

/**
 * Remark plugin to handle callout/admonition syntax (fallback for edge cases)
 * Most callouts are handled by preprocessCallouts, this catches any remaining ones
 */
function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || index === undefined) return
      
      // Get the text content of first child to check for opening :::
      const firstChild = node.children[0]
      if (!firstChild || firstChild.type !== 'text') return
      
      const text = firstChild.value
      
      // Check for single-paragraph callout that might have been missed
      // Pattern: :::type content ::: all in one paragraph
      const singleLineMatch = text.match(/^:::(info|warning|error|success|tip|note|danger)\s+/)
      if (!singleLineMatch) return
      
      const calloutType = singleLineMatch[1]
      
      // Check if this paragraph ends with :::
      const lastChild = node.children[node.children.length - 1]
      let endsWithClose = false
      
      if (lastChild.type === 'text' && lastChild.value.trim().endsWith(':::')) {
        endsWithClose = true
      }
      
      if (!endsWithClose) return
      
      // Remove the opening :::type from first text node
      const newChildren = [...node.children]
      if (newChildren[0].type === 'text') {
        (newChildren[0] as Text).value = text.slice(singleLineMatch[0].length)
      }
      
      // Remove the closing ::: from last text node
      const lastIdx = newChildren.length - 1
      if (newChildren[lastIdx].type === 'text') {
        const lastText = (newChildren[lastIdx] as Text).value
        (newChildren[lastIdx] as Text).value = lastText.replace(/\s*:::$/, '')
      }
      
      // @ts-expect-error - Adding custom node structure
      parent.children[index] = {
        type: 'callout',
        data: {
          hName: 'div',
          hProperties: {
            className: ['callout', `callout-${calloutType}`],
          },
        },
        children: [{
          type: 'paragraph',
          children: newChildren,
        }],
      }
    })
  }
}

/**
 * Remark plugin to handle API endpoint syntax
 * 
 * Syntax:
 * :::api GET /users/{id}
 * Get user by ID
 * 
 * Retrieves a specific user by their unique identifier.
 * :::
 * 
 * Supported methods: GET, POST, PUT, PATCH, DELETE
 */
// =============================================================================
// EMBED PROVIDERS (Phase 2.2)
// =============================================================================

/**
 * Embed provider handlers. Each returns the HTML for a specific platform.
 * Unknown URLs get a styled link card.
 */

interface EmbedResult {
  html: string
  plainText: string // For /llms.txt output
}

function youtubeEmbed(url: string, title: string): EmbedResult {
  // Extract video ID from various YouTube URL formats
  let videoId = ''
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'youtu.be') {
      videoId = parsed.pathname.slice(1)
    } else {
      videoId = parsed.searchParams.get('v') || ''
    }
  } catch {
    // Try extracting from URL string directly
    const match = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    videoId = match?.[1] || ''
  }

  if (!videoId) return linkCardEmbed(url, title)

  return {
    html: `<div class="embed-container embed-youtube"><iframe src="https://www.youtube.com/embed/${escapeHtml(videoId)}" title="${escapeHtml(title || 'YouTube Video')}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>`,
    plainText: `[YouTube Video: ${title || 'Untitled'}](${url})`,
  }
}

function loomEmbed(url: string, title: string): EmbedResult {
  // Extract share ID from Loom URL
  let shareId = ''
  try {
    const parsed = new URL(url)
    const pathParts = parsed.pathname.split('/')
    shareId = pathParts[pathParts.length - 1] || ''
  } catch {}

  if (!shareId) return linkCardEmbed(url, title)

  return {
    html: `<div class="embed-container embed-loom"><iframe src="https://www.loom.com/embed/${escapeHtml(shareId)}" title="${escapeHtml(title || 'Loom Video')}" frameborder="0" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe></div>`,
    plainText: `[Loom Video: ${title || 'Untitled'}](${url})`,
  }
}

function figmaEmbed(url: string, title: string): EmbedResult {
  const encodedUrl = encodeURIComponent(url)
  return {
    html: `<div class="embed-container embed-figma"><iframe src="https://www.figma.com/embed?embed_host=f0&url=${encodedUrl}" title="${escapeHtml(title || 'Figma Design')}" allowfullscreen loading="lazy"></iframe></div>`,
    plainText: `[Figma Design: ${title || 'Untitled'}](${url})`,
  }
}

function gistEmbed(url: string, title: string): EmbedResult {
  // GitHub Gists can't be server-side rendered via iframe easily.
  // Provide a styled link card with a direct link.
  return {
    html: `<div class="embed-card embed-gist"><div class="embed-card-icon"><svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25H1.75zM0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0114.25 16H1.75A1.75 1.75 0 010 14.25V1.75z"></path></svg></div><div class="embed-card-body"><div class="embed-card-title">${escapeHtml(title || 'GitHub Gist')}</div><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="embed-card-url">${escapeHtml(url)} ↗</a></div></div>`,
    plainText: `[GitHub Gist: ${title || 'Untitled'}](${url})`,
  }
}

function linkCardEmbed(url: string, title: string): EmbedResult {
  // Generic link card for unknown embed providers
  let hostname = ''
  try { hostname = new URL(url).hostname } catch {}

  return {
    html: `<div class="embed-card"><div class="embed-card-body"><div class="embed-card-title">${escapeHtml(title || hostname || 'External Content')}</div><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="embed-card-url">${escapeHtml(url)} ↗</a></div></div>`,
    plainText: `[${title || hostname || 'Link'}](${url})`,
  }
}

/**
 * Map domain names to embed handlers.
 */
const embedProviders: Record<string, (url: string, title: string) => EmbedResult> = {
  'youtube.com': youtubeEmbed,
  'www.youtube.com': youtubeEmbed,
  'youtu.be': youtubeEmbed,
  'loom.com': loomEmbed,
  'www.loom.com': loomEmbed,
  'figma.com': figmaEmbed,
  'www.figma.com': figmaEmbed,
  'gist.github.com': gistEmbed,
}

function resolveEmbedProvider(url: string): ((url: string, title: string) => EmbedResult) {
  try {
    const hostname = new URL(url).hostname
    return embedProviders[hostname] || linkCardEmbed
  } catch {
    return linkCardEmbed
  }
}

// =============================================================================
// EMBED REMARK PLUGIN (Phase 2.2)
// =============================================================================

/**
 * Pre-process markdown to convert embed and mermaid directives.
 * Runs BEFORE remark parsing.
 * 
 * Supported syntax:
 *   ::embed[Display Title]{url=https://www.loom.com/share/abc123}
 *   ::mermaid
 *   graph TD
 *     A[Start] --> B[Process]
 *   ::
 */
function preprocessEmbeds(markdown: string): string {
  // Handle ::embed[Title]{url=URL}
  const embedRegex = /^::embed\[([^\]]*)\]\{url=([^}]+)\}\s*$/gm
  markdown = markdown.replace(embedRegex, (_match, title, url) => {
    const provider = resolveEmbedProvider(url)
    const result = provider(url, title)
    return result.html
  })

  // Handle ::mermaid ... ::
  // Render as a code block with language-mermaid class for optional client-side rendering.
  // The /llms.txt output preserves the mermaid source.
  const mermaidRegex = /^::mermaid\s*\n([\s\S]*?)\n::\s*$/gm
  markdown = markdown.replace(mermaidRegex, (_match, content) => {
    const trimmed = content.trim()
    return `<div class="mermaid-container"><pre class="mermaid" data-mermaid="true">${escapeHtml(trimmed)}</pre></div>`
  })

  return markdown
}

/**
 * Extract embed plain text references for /llms.txt output.
 * Call this during markdownToPlainText to convert embeds to text references.
 */
function stripEmbedsToPlainText(text: string): string {
  // Convert ::embed directives to plain text links
  text = text.replace(/^::embed\[([^\]]*)\]\{url=([^}]+)\}\s*$/gm, (_match, title, url) => {
    return `[${title || 'Embedded Content'}](${url})`
  })

  // Preserve mermaid source for LLMs
  text = text.replace(/^::mermaid\s*\n([\s\S]*?)\n::\s*$/gm, (_match, content) => {
    return `[Mermaid Diagram]\n${content.trim()}`
  })

  return text
}

/**
 * Pre-process markdown to convert :::api blocks to HTML.
 * Runs BEFORE remark parsing to avoid paragraph-merging issues.
 * 
 * This replaces the remark plugin approach because remark merges
 * adjacent lines without blank lines into single paragraph nodes,
 * breaking regex matching on the AST.
 */
function preprocessApiBlocks(markdown: string): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const match = line.match(/^:::api\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+?)\s*$/i)

    if (!match) {
      result.push(line)
      i++
      continue
    }

    const [, method, path] = match
    const methodLower = method.toLowerCase()

    // Collect content until closing :::
    i++
    const contentLines: string[] = []
    let inCodeBlock = false
    let found = false

    while (i < lines.length) {
      const current = lines[i]

      // Track fenced code blocks to avoid matching ::: inside them
      if (current.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock
      }

      if (!inCodeBlock && current.trim() === ':::') {
        found = true
        i++
        break
      }

      contentLines.push(current)
      i++
    }

    if (!found) {
      // No closing ::: found — output original text unchanged
      result.push(line)
      result.push(...contentLines)
      continue
    }

    // First non-empty line is the summary
    const firstNonEmptyIdx = contentLines.findIndex(l => l.trim().length > 0)
    const summary = firstNonEmptyIdx >= 0 ? contentLines[firstNonEmptyIdx].trim() : ''

    // Everything after the summary line is the body (markdown content)
    const bodyLines = firstNonEmptyIdx >= 0 ? contentLines.slice(firstNonEmptyIdx + 1) : contentLines
    const body = bodyLines.join('\n').trim()

    // Emit HTML wrapper — blank lines around body content ensure remark parses it as markdown
    result.push(`<div class="api-endpoint api-endpoint-${methodLower}">`)
    result.push(`<div class="api-endpoint-header"><span class="api-method api-method-${methodLower}">${method.toUpperCase()}</span><code class="api-path">${escapeHtml(path.trim())}</code></div>`)
    if (summary) {
      result.push(`<p class="api-endpoint-summary">${escapeHtml(summary)}</p>`)
    }
    if (body) {
      result.push('')
      result.push(body)
      result.push('')
    }
    result.push('</div>')
    result.push('')
  }

  return result.join('\n')
}

function remarkApiEndpoints() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || index === undefined) return
      if (node.children.length !== 1 || node.children[0].type !== 'text') return
      
      const text = (node.children[0] as Text).value
      
      // Match single-paragraph API endpoint (:::api METHOD /path\ndescription\n:::)
      const singleMatch = text.match(/^:::api\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+?)\n([\s\S]*?)\n:::$/i)
      if (singleMatch) {
        const [, method, path, content] = singleMatch
        const methodLower = method.toLowerCase()
        
        // Parse content - first line is summary, rest is description
        const lines = content.trim().split('\n')
        const summary = lines[0] || ''
        const description = lines.slice(1).join('\n').trim()
        
        // @ts-expect-error - Adding custom node structure
        parent.children[index] = {
          type: 'apiEndpoint',
          data: {
            hName: 'div',
            hProperties: {
              className: ['api-endpoint', `api-endpoint-${methodLower}`],
            },
          },
          children: [
            {
              type: 'html',
              value: `<div class="api-endpoint-header"><span class="api-method api-method-${methodLower}">${method.toUpperCase()}</span><code class="api-path">${escapeHtml(path)}</code></div>`,
            },
            ...(summary ? [{
              type: 'paragraph',
              data: { hProperties: { className: ['api-endpoint-summary'] } },
              children: [{ type: 'text', value: summary }],
            }] : []),
            ...(description ? [{
              type: 'paragraph',
              data: { hProperties: { className: ['api-endpoint-description'] } },
              children: [{ type: 'text', value: description }],
            }] : []),
          ],
        }
        return
      }
      
      // Check for API endpoint opening (multi-line)
      const openMatch = text.match(/^:::api\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+?)\s*$/i)
      if (!openMatch) return
      
      const [, method, path] = openMatch
      const methodLower = method.toLowerCase()
      
      // Find the closing :::
      let endIndex = index + 1
      const contentNodes: unknown[] = []
      
      while (endIndex < parent.children.length) {
        const child = parent.children[endIndex]
        
        // Check for closing :::
        if (
          child.type === 'paragraph' &&
          child.children.length === 1 &&
          child.children[0].type === 'text' &&
          (child.children[0] as Text).value.trim() === ':::'
        ) {
          break
        }
        
        contentNodes.push(child)
        endIndex++
      }
      
      // If we found a closing tag, transform the nodes
      if (endIndex < parent.children.length) {
        // @ts-expect-error - Adding custom node structure
        const apiNode = {
          type: 'apiEndpoint',
          data: {
            hName: 'div',
            hProperties: {
              className: ['api-endpoint', `api-endpoint-${methodLower}`],
            },
          },
          children: [
            {
              type: 'html',
              value: `<div class="api-endpoint-header"><span class="api-method api-method-${methodLower}">${method.toUpperCase()}</span><code class="api-path">${escapeHtml(path)}</code></div>`,
            },
            ...contentNodes,
          ],
        }
        
        parent.children.splice(index, endIndex - index + 1, apiNode)
      }
    })
  }
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// =============================================================================
// CUSTOM REHYPE PLUGINS
// =============================================================================

/**
 * Responsive image widths for srcset generation.
 */
const RESPONSIVE_WIDTHS = [400, 800, 1200]

/**
 * Rehype plugin to transform images for responsive delivery.
 * 
 * Phase 2.1 — Handles two concerns:
 * 1. Path portability: Resolves relative paths (./assets/images/x.png) to
 *    API URLs (/api/content/assets/images/x.png). This means Markdown files
 *    can be previewed in GitHub, VS Code, or any standard viewer.
 * 2. Responsive images: Wraps <img> in <picture> with WebP srcset at
 *    multiple widths, with lazy loading and async decoding.
 */
function rehypeResponsiveImages() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'img' || !parent || index === undefined) return

      const src = node.properties?.src as string
      if (!src) return

      // Skip external images and already-processed API URLs
      if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/api/')) return
      // Skip data URIs
      if (src.startsWith('data:')) return

      // Resolve relative paths to API URLs (same rule as cover_image, brand assets)
      const apiSrc = resolveAssetUrl(src)

      const alt = (node.properties?.alt as string) || ''
      const ext = apiSrc.split('.').pop()?.toLowerCase() || ''

      // SVGs and GIFs don't get responsive treatment
      if (ext === 'svg' || ext === 'gif') {
        node.properties = { ...node.properties, src: apiSrc, loading: 'lazy', decoding: 'async' }
        return
      }

      // Build responsive <picture> element
      const webpSrcset = RESPONSIVE_WIDTHS
        .map(w => `${apiSrc}?w=${w}&f=webp ${w}w`)
        .join(', ')

      const pictureNode: Element = {
        type: 'element',
        tagName: 'picture',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'source',
            properties: {
              srcSet: webpSrcset,
              type: 'image/webp',
            },
            children: [],
          },
          {
            type: 'element',
            tagName: 'img',
            properties: {
              src: `${apiSrc}?w=800`,
              alt,
              loading: 'lazy',
              decoding: 'async',
            },
            children: [],
          },
        ],
      }

      parent.children[index] = pictureNode
    })
  }
}

/**
 * Rehype plugin to extract table of contents from headings
 * Collects all H2 and H3 headings with their slugs
 */
function rehypeExtractToc() {
  return (tree: HastRoot, file: VFile) => {
    // Per-document output goes on the file, so one frozen processor can be
    // shared by every render.
    const toc: TocItem[] = []
    file.data.toc = toc
    visit(tree, 'element', (node: Element) => {
      if (!['h2', 'h3'].includes(node.tagName)) return
      
      const level = parseInt(node.tagName[1])
      const id = node.properties?.id as string
      
      // Extract text content from heading
      let text = ''
      visit(node, 'text', (textNode: { value: string }) => {
        text += textNode.value
      })
      
      if (!id || !text) return
      
      const tocItem: TocItem = { id, text, level, children: [] }
      
      if (level === 2) {
        // H2 goes to top level
        toc.push(tocItem)
      } else if (level === 3 && toc.length > 0) {
        // H3 goes under the most recent H2
        toc[toc.length - 1].children.push(tocItem)
      }
    })
  }
}

/**
 * Rehype plugin: resolve relative src on <img> written as raw HTML in
 * Markdown (<img src="./assets/x.png">). Markdown images are handled earlier
 * by rehypeResponsiveImages; raw HTML only becomes elements after rehype-raw.
 */
function rehypeResolveRawImageSources() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'img' && node.tagName !== 'source') return
      const src = node.properties?.src
      if (typeof src === 'string' && src) {
        node.properties = { ...node.properties, src: resolveAssetUrl(src) }
      }
    })
  }
}

/**
 * Rehype plugin to wrap code blocks with header (filename + copy button)
 * Detects language from class and adds metadata
 */
function rehypeCodeBlocks() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === undefined) return
      
      // Find the code element inside pre
      const codeElement = node.children.find(
        (child): child is Element => 
          child.type === 'element' && child.tagName === 'code'
      )
      
      if (!codeElement) return
      
      // Extract language from class (e.g., "language-typescript")
      const classNames = codeElement.properties?.className as string[] | undefined
      const langClass = classNames?.find(c => c.startsWith('language-'))
      const language = langClass?.replace('language-', '') || 'text'
      
      // Special handling for mermaid diagrams
      if (language === 'mermaid') {
        // Extract the mermaid code content
        let mermaidCode = ''
        const extractText = (children: typeof codeElement.children) => {
          for (const child of children) {
            if (child.type === 'text') {
              mermaidCode += child.value
            } else if (child.type === 'element' && 'children' in child) {
              extractText(child.children)
            }
          }
        }
        extractText(codeElement.children)
        
        // Create mermaid container that will be rendered client-side
        const mermaidWrapper: Element = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['mermaid-wrapper'] },
          children: [
            {
              type: 'element',
              tagName: 'div',
              properties: { 
                className: ['mermaid'],
                'data-mermaid': 'true',
              },
              children: [{ type: 'text', value: mermaidCode.trim() }],
            },
          ],
        }
        
        parent.children[index] = mermaidWrapper
        return
      }
      
      // Wrap the pre in a code-block container (for non-mermaid blocks)
      const wrapper: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['code-block'] },
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['code-block-header'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['code-block-language'] },
                children: [{ type: 'text', value: language }],
              },
              {
                type: 'element',
                tagName: 'button',
                properties: { 
                  className: ['copy-button'],
                  'data-copy': 'true',
                  type: 'button',
                },
                children: [{ type: 'text', value: 'Copy' }],
              },
            ],
          },
          node,
        ],
      }
      
      parent.children[index] = wrapper
    })
  }
}

// =============================================================================
// FRONTMATTER PARSING
// =============================================================================

/**
 * Extract YAML frontmatter from markdown content
 * 
 * Frontmatter is enclosed in --- at the start of the file:
 * ---
 * title: My Page
 * order: 1
 * ---
 */
export function extractFrontmatter(content: string): { 
  frontmatter: MarkdownFrontmatter
  content: string 
} {
  // One reader for all of f0 (BOM, CRLF, empty blocks, missing final newline)
  const { data, body } = readFrontmatter(content)
  return { frontmatter: data as MarkdownFrontmatter, content: body }
}

/**
 * Extract the first H1 heading from markdown as fallback title
 */
function extractTitle(content: string): string {
  // Fence-aware: a shell comment inside a code block is not a title
  return firstHeading(content) ?? ''
}

// =============================================================================
// PLAIN TEXT EXTRACTION (FOR LLM OUTPUT)
// =============================================================================

/**
 * Convert markdown to plain text for LLM consumption
 * Strips all formatting while preserving structure and meaning
 * 
 * This aligns with constraint C-AI-LLMS-NO-UI-NOISE-004:
 * "LLM ingestion must be context-dense and free of presentation artifacts"
 */
export function markdownToPlainText(content: string): string {
  // Remove frontmatter
  const { content: mdContent } = extractFrontmatter(content)
  
  // Code is masked while the text rules run, then restored: inline code
  // without backticks, fenced code without its fence lines. (The rules used to
  // run over code too: NUXT_PUBLIC_SITE_NAME lost its underscores and a bash
  // `# comment` became a heading.)
  const { text: masked, blocks } = maskFencedCode(mdContent)
  const inlineCode: string[] = []
  let text = masked.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    inlineCode.push(code)
    return `\uE000C${inlineCode.length - 1}\uE001`
  })
  
  // Convert YouTube embeds to text reference
  text = text.replace(
    /::youtube\[([^\]]*)\]\{id=([^}]+)\}/g, 
    '[Video: $1 - https://youtube.com/watch?v=$2]'
  )
  
  // Convert ::embed and ::mermaid directives to plain text (Phase 2.2)
  text = stripEmbedsToPlainText(text)
  
  // Convert callouts to plain text (keep content, remove markers)
  text = text.replace(/^:::api\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(.+?)\s*$/gm, '$1 $2')
  text = text.replace(/:::(info|warning|error|success)\s*/g, '')
  text = text.replace(/^:::(tabs|steps|cards)[ \t]*$/gm, '')
  text = text.replace(/^@tab[ \t]+(.+?)[ \t]*$/gm, '$1:')
  text = text.replace(/:::\s*/g, '')
  
  // Convert headings (keep text, indicate level)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => `\n${heading}\n${'='.repeat(heading.length)}`)
  
  // Convert links to text with URL
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  
  // Convert images to text description
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[Image: $1]')
  
  // Remove bold/italic markers. Emphasis does not start or end next to a
  // space (so "*.md and *.json" survives), and underscores inside words are
  // not emphasis (so snake_case and SCREAMING_CASE survive).
  text = text.replace(/\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*/g, '$1')
  text = text.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, '$1')
  text = text.replace(/(^|[^\p{L}\p{N}_])__(?!\s)([^_\n]+?)(?<!\s)__(?![\p{L}\p{N}_])/gu, '$1$2')
  text = text.replace(/(^|[^\p{L}\p{N}_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, '$1$2')
  
  // Remove horizontal rules
  text = text.replace(/^---+$/gm, '')
  text = text.replace(/^\*\*\*+$/gm, '')
  
  // Restore code
  text = text.replace(MASK_TOKEN, (token, kind, index) => {
    if (kind === 'C') return inlineCode[Number(index)] ?? token
    const block = blocks[Number(index)]
    return block ? `\n${block.body}\n` : token
  })
  
  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()
  
  return text
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * The rendering pipeline, built once and frozen. Every plugin is stateless
 * per document (the TOC is written to file.data), so all renders share it
 * instead of rebuilding the plugin chain, highlighter included, per page.
 */
let markdownProcessor: Processor<any, any, any, any, any> | null = null

function getMarkdownProcessor() {
  if (!markdownProcessor) {
    markdownProcessor = unified()
      // Parse markdown to AST
      .use(remarkParse)
      // Add GFM support (tables, task lists, strikethrough, autolinks)
      .use(remarkGfm)
      // Custom: YouTube embeds
      .use(remarkYouTube)
      // Custom: Callout boxes (fallback for edge cases)
      .use(remarkCallouts)
      // Custom: API endpoint blocks
      .use(remarkApiEndpoints)
      // Convert to HTML AST
      .use(remarkRehype, { allowDangerousHtml: true })
      // Add slugs to headings for linking
      .use(rehypeSlug)
      // Responsive images (path resolution + srcset + lazy loading)
      .use(rehypeResponsiveImages)
      // Extract TOC from headings (into file.data.toc)
      .use(rehypeExtractToc)
      // Syntax highlighting for code blocks (disable auto-detect to prevent errors)
      .use(rehypeHighlight, { detect: false, ignoreMissing: true })
      // Wrap code blocks with copy button UI
      .use(rehypeCodeBlocks)
      // Parse raw HTML (author HTML and f0's preprocessed blocks) into real
      // nodes, then strip script-capable constructs. Runs after slugs and TOC,
      // so heading anchors are unaffected.
      .use(rehypeDropTableWhitespace)
      .use(rehypeRaw)
      .use(rehypeResolveRawImageSources)
      .use(rehypeRestoreTableWhitespace)
      .use(rehypeStripDangerous)
      // Convert to HTML string
      .use(rehypeStringify, { allowDangerousHtml: true })
      .freeze() as unknown as Processor<any, any, any, any, any>
  }
  return markdownProcessor
}

/**
 * Parse a markdown file and return HTML, TOC, and metadata
 * 
 * @param content - Raw markdown content including frontmatter
 * @returns ParsedMarkdown object with all extracted data
 */
export async function parseMarkdown(content: string, fallbackTitle: string = 'Untitled'): Promise<ParsedMarkdown> {
  // Extract frontmatter
  const { frontmatter, content: mdContent } = extractFrontmatter(content)
  
  // Pre-process callouts before remark parsing
  // This converts :::type ... ::: blocks to HTML divs
  const preprocessedContent = preprocessDirectives(mdContent)
  
  // Extract title from first H1 as fallback
  const extractedTitle = extractTitle(preprocessedContent)
  
  try {
    // Process the markdown, then re-parse the HTML the way the browser will
    // and sanitize again until stable (defeats mutation XSS)
    const result = await getMarkdownProcessor().process(preprocessedContent)
    const html = stabilizeHtml(String(result))
    const toc = (result.data.toc as TocItem[] | undefined) ?? []
    
    // Generate plain text for LLM
    const plainText = markdownToPlainText(content)
    
    return {
      html,
      frontmatter,
      toc,
      plainText,
      title: stringField(frontmatter, 'title') ?? (extractedTitle || fallbackTitle),
    }
  } catch (error) {
    logger.error('Error parsing content', { error: error instanceof Error ? error.message : String(error) })
    
    // Return a basic parsed result with error message
    return {
      html: `<div class="callout callout-error"><p>Error rendering content. Please check the markdown syntax.</p></div><pre>${escapeHtml(mdContent)}</pre>`,
      frontmatter,
      toc: [],
      plainText: mdContent,
      title: stringField(frontmatter, 'title') ?? (extractedTitle || fallbackTitle),
    }
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Generate an excerpt from markdown body content
 * Strips all markdown syntax, takes the first N characters, truncates at word boundary
 */
export function generateExcerpt(markdownBody: string, maxLength: number = 160): string {
  let text = markdownBody

  // Remove frontmatter if accidentally included
  text = readFrontmatter(text).body

  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`[^`]+`/g, '')

  // Remove callout markers
  text = text.replace(/^:::api\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+.+?\s*$/gm, '')
  text = text.replace(/:::(info|warning|error|success|tip|note|danger)\s*/g, '')
  text = text.replace(/:::\s*/g, '')

  // Remove YouTube embeds
  text = text.replace(/::youtube\[[^\]]*\]\{[^}]+\}/g, '')

  // Remove headings
  text = text.replace(/^#{1,6}\s+/gm, '')

  // Remove images
  text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '')

  // Convert links to text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // Remove bold/italic/strikethrough
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')
  text = text.replace(/~~([^~]+)~~/g, '$1')

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Remove horizontal rules
  text = text.replace(/^---+$/gm, '')
  text = text.replace(/^\*\*\*+$/gm, '')

  // Collapse whitespace
  text = text.replace(/\n+/g, ' ')
  text = text.replace(/\s+/g, ' ')
  text = text.trim()

  if (text.length <= maxLength) return text

  // Truncate at last word boundary
  const truncated = text.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  const result = lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated

  return result + '...'
}

/**
 * Calculate estimated reading time in minutes
 * Based on average reading speed of 200 words per minute
 */
export function calculateReadingTime(markdownBody: string): number {
  // Strip frontmatter
  const text = readFrontmatter(markdownBody).body
  const words = text.split(/\s+/).filter(w => w.length > 0).length
  return Math.max(1, Math.ceil(words / 200))
}

/**
 * Extract date from a filename prefix (YYYY-MM-DD-slug.md)
 */
export function extractDateFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-/)
  return match ? match[1] : null
}

/**
 * Check if content is markdown based on extension
 */
export function isMarkdownFile(filename: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(filename)
}

/**
 * Check if content is a JSON spec file (OpenAPI or Postman)
 */
export function isJsonSpecFile(filename: string): boolean {
  return /\.json$/i.test(filename)
}

/**
 * Sanitize a string for use as a slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// =============================================================================
// ERROR-RESILIENT PARSING (Phase 1.4)
// =============================================================================

/** Maximum file size in bytes that we'll attempt to parse (1MB) */
const MAX_PARSE_SIZE = 1_048_576

/**
 * Safely extract frontmatter — returns empty object on any failure.
 * Never throws.
 */
export function extractFrontmatterSafe(content: string): MarkdownFrontmatter {
  try {
    const { frontmatter } = extractFrontmatter(content)
    return frontmatter
  } catch {
    return {}
  }
}

/**
 * Safely extract a title from content — returns the file path as fallback.
 * Never throws.
 */
export function extractTitleSafe(content: string, fallback: string = 'Untitled'): string {
  try {
    const doc = readFrontmatter(content)
    return stringField(doc.data, 'title') ?? firstHeading(doc.body) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Error-resilient markdown parser.
 * 
 * Wraps the full remark/rehype pipeline in an error boundary. If parsing
 * fails for any reason (malformed YAML, Unicode issues in code blocks,
 * deeply nested lists causing stack overflow, etc.), returns a graceful
 * fallback that shows the raw markdown in a <pre> block with an error notice.
 * 
 * DESIGN PRINCIPLE: A parsing error in one file should never affect other files.
 * The error page should be informative (dev) and graceful (production).
 * 
 * @param content - Raw markdown content including frontmatter
 * @param filePath - File path for error reporting (optional)
 * @returns ParsedMarkdown — always succeeds, never throws
 */
export async function parseMarkdownSafe(content: string, filePath: string = 'unknown'): Promise<ParsedMarkdown> {
  // Pages without a title or H1 are named after their file, never 'Untitled'
  // and never the absolute path on the server
  const fallbackTitle = filePath === 'unknown' ? 'Untitled' : titleFromFileName(filePath)
  // Guard: reject files over MAX_PARSE_SIZE
  if (content.length > MAX_PARSE_SIZE) {
    const title = extractTitleSafe(content, fallbackTitle)
    const isProduction = process.env.NODE_ENV === 'production'
    return {
      html: `<div class="callout callout-warning">
        <p><strong>Large file.</strong> This file exceeds the maximum rendering size (${Math.round(MAX_PARSE_SIZE / 1024)}KB). ${isProduction ? '' : `Actual size: ${Math.round(content.length / 1024)}KB.`}</p>
      </div><pre>${escapeHtml(content.slice(0, 10000))}${content.length > 10000 ? '\n\n[... truncated ...]' : ''}</pre>`,
      frontmatter: extractFrontmatterSafe(content),
      toc: [],
      plainText: content.slice(0, MAX_PARSE_SIZE),
      title,
    }
  }

  try {
    return await parseMarkdown(content, fallbackTitle)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const title = extractTitleSafe(content, fallbackTitle)
    const isProduction = process.env.NODE_ENV === 'production'

    // Log the error with context
    logger.error('Markdown parsing failed', { path: filePath, error: errorMessage })

    // Fallback: render raw markdown in a <pre> block with an error notice
    const errorNotice = isProduction
      ? '<p>This page could not be rendered. Please contact the site administrator.</p>'
      : `<p>This page could not be rendered. The Markdown source is shown below.</p>
         <p><small>Error: ${escapeHtml(errorMessage)}</small></p>`

    // Try to get plainText even if full parse failed
    let plainText: string
    try {
      plainText = markdownToPlainText(content)
    } catch {
      // If even plainText extraction fails, use raw content
      plainText = content
    }

    return {
      html: `<div class="callout callout-error">${errorNotice}</div><pre>${escapeHtml(content)}</pre>`,
      frontmatter: extractFrontmatterSafe(content),
      toc: [],
      plainText,
      title,
    }
  }
}