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

import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeHighlight from 'rehype-highlight'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import type { Root, Text, Paragraph } from 'mdast'
import type { Root as HastRoot, Element } from 'hast'
import yaml from 'yaml'
import { logger } from './logger'

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
function preprocessCallouts(markdown: string): string {
  // Match callout blocks: :::type followed by content followed by :::
  // Use a regex that captures the type and content
  const calloutRegex = /^:::(info|warning|error|success|tip|note|danger)\s*\n([\s\S]*?)\n:::\s*$/gm
  
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
    return `<div class="mermaid-container"><pre class="mermaid">${escapeHtml(trimmed)}</pre></div>`
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

      // Resolve relative paths to API URLs
      let apiSrc = src
      if (src.startsWith('./assets/') || src.startsWith('assets/')) {
        apiSrc = '/api/content/' + src.replace(/^\.\//, '')
      } else if (src.startsWith('./') || !src.startsWith('/')) {
        // Other relative paths — prefix with API
        apiSrc = '/api/content/assets/' + src.replace(/^\.\//, '')
      }

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
function rehypeExtractToc(toc: TocItem[]) {
  return (tree: HastRoot) => {
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
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
  const match = content.match(frontmatterRegex)
  
  if (!match) {
    return { frontmatter: {}, content }
  }
  
  try {
    const frontmatter = yaml.parse(match[1]) as MarkdownFrontmatter
    const contentWithoutFrontmatter = content.slice(match[0].length)
    return { frontmatter, content: contentWithoutFrontmatter }
  } catch {
    // If YAML parsing fails, treat it as no frontmatter
    logger.warn('Failed to parse frontmatter, treating as content')
    return { frontmatter: {}, content }
  }
}

/**
 * Extract the first H1 heading from markdown as fallback title
 */
function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : ''
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
  
  let text = mdContent
  
  // Convert YouTube embeds to text reference
  text = text.replace(
    /::youtube\[([^\]]*)\]\{id=([^}]+)\}/g, 
    '[Video: $1 - https://youtube.com/watch?v=$2]'
  )
  
  // Convert ::embed and ::mermaid directives to plain text (Phase 2.2)
  text = stripEmbedsToPlainText(text)
  
  // Convert callouts to plain text (keep content, remove markers)
  text = text.replace(/:::(info|warning|error|success)\s*/g, '')
  text = text.replace(/:::\s*/g, '')
  
  // Convert headings (keep text, indicate level)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, heading) => `\n${heading}\n${'='.repeat(heading.length)}`)
  
  // Convert links to text with URL
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  
  // Convert images to text description
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '[Image: $1]')
  
  // Remove inline code backticks (keep content)
  text = text.replace(/`([^`]+)`/g, '$1')
  
  // Remove code block markers (keep content)
  text = text.replace(/```[\w]*\n/g, '\n')
  text = text.replace(/```/g, '')
  
  // Remove bold/italic markers
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/_([^_]+)_/g, '$1')
  
  // Remove horizontal rules
  text = text.replace(/^---+$/gm, '')
  text = text.replace(/^\*\*\*+$/gm, '')
  
  // Clean up excessive whitespace
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()
  
  return text
}

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse a markdown file and return HTML, TOC, and metadata
 * 
 * @param content - Raw markdown content including frontmatter
 * @returns ParsedMarkdown object with all extracted data
 */
export async function parseMarkdown(content: string): Promise<ParsedMarkdown> {
  // Extract frontmatter
  const { frontmatter, content: mdContent } = extractFrontmatter(content)
  
  // Pre-process callouts before remark parsing
  // This converts :::type ... ::: blocks to HTML divs
  const preprocessedContent = preprocessEmbeds(preprocessCallouts(mdContent))
  
  // Extract title from first H1 as fallback
  const extractedTitle = extractTitle(preprocessedContent)
  
  // TOC will be populated by the rehype plugin
  const toc: TocItem[] = []
  
  try {
    // Build the processing pipeline
    const processor = unified()
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
      // Extract TOC from headings
      .use(() => rehypeExtractToc(toc))
      // Syntax highlighting for code blocks (disable auto-detect to prevent errors)
      .use(rehypeHighlight, { detect: false, ignoreMissing: true })
      // Wrap code blocks with copy button UI
      .use(rehypeCodeBlocks)
      // Convert to HTML string
      .use(rehypeStringify, { allowDangerousHtml: true })
    
    // Process the markdown
    const result = await processor.process(preprocessedContent)
    const html = String(result)
    
    // Generate plain text for LLM
    const plainText = markdownToPlainText(content)
    
    return {
      html,
      frontmatter,
      toc,
      plainText,
      title: frontmatter.title || extractedTitle || 'Untitled',
    }
  } catch (error) {
    logger.error('Error parsing content', { error: error instanceof Error ? error.message : String(error) })
    
    // Return a basic parsed result with error message
    return {
      html: `<div class="callout callout-error"><p>Error rendering content. Please check the markdown syntax.</p></div><pre>${escapeHtml(mdContent)}</pre>`,
      frontmatter,
      toc: [],
      plainText: mdContent,
      title: frontmatter.title || extractedTitle || 'Untitled',
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
  text = text.replace(/^---\n[\s\S]*?\n---\n?/, '')

  // Remove code blocks
  text = text.replace(/```[\s\S]*?```/g, '')
  text = text.replace(/`[^`]+`/g, '')

  // Remove callout markers
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
  const text = markdownBody.replace(/^---\n[\s\S]*?\n---\n?/, '')
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
    // Try frontmatter title first
    const fm = extractFrontmatterSafe(content)
    if (fm.title && typeof fm.title === 'string') return fm.title

    // Try first H1
    const match = content.match(/^#\s+(.+)$/m)
    if (match) return match[1].trim()

    return fallback
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
  // Guard: reject files over MAX_PARSE_SIZE
  if (content.length > MAX_PARSE_SIZE) {
    const title = extractTitleSafe(content, filePath)
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
    return await parseMarkdown(content)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const title = extractTitleSafe(content, filePath)
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
