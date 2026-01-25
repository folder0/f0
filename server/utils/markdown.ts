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
 * Remark plugin to handle callout/admonition syntax
 * 
 * Syntax (multi-line):
 * :::info
 * 
 * This is an info callout
 * 
 * :::
 * 
 * Syntax (single paragraph - when lines run together):
 * :::info\nThis is an info callout\n:::
 * 
 * Supported types: info, warning, error, success
 */
function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (!parent || index === undefined) return
      if (node.children.length !== 1 || node.children[0].type !== 'text') return
      
      const text = (node.children[0] as Text).value
      
      // Try to match single-paragraph callout (:::type\ncontent\n:::)
      const singleMatch = text.match(/^:::(info|warning|error|success)\n([\s\S]*?)\n:::$/)
      if (singleMatch) {
        const [, calloutType, content] = singleMatch
        
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
            children: [{
              type: 'text',
              value: content.trim(),
            }],
          }],
        }
        return
      }
      
      // Check for callout opening (multi-paragraph variant)
      const openMatch = text.match(/^:::(info|warning|error|success)\s*$/)
      if (!openMatch) return
      
      const calloutType = openMatch[1]
      
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
        // Create callout wrapper
        // @ts-expect-error - Adding custom node structure
        const calloutNode = {
          type: 'callout',
          data: {
            hName: 'div',
            hProperties: {
              className: ['callout', `callout-${calloutType}`],
            },
          },
          children: contentNodes,
        }
        
        // Replace the range of nodes with our callout
        parent.children.splice(index, endIndex - index + 1, calloutNode)
      }
    })
  }
}

// =============================================================================
// CUSTOM REHYPE PLUGINS
// =============================================================================

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
      
      // Wrap the pre in a code-block container
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
function extractFrontmatter(content: string): { 
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
    console.warn('Failed to parse frontmatter, treating as content')
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
  
  // Extract title from first H1 as fallback
  const extractedTitle = extractTitle(mdContent)
  
  // TOC will be populated by the rehype plugin
  const toc: TocItem[] = []
  
  // Build the processing pipeline
  const processor = unified()
    // Parse markdown to AST
    .use(remarkParse)
    // Add GFM support (tables, task lists, strikethrough, autolinks)
    .use(remarkGfm)
    // Custom: YouTube embeds
    .use(remarkYouTube)
    // Custom: Callout boxes
    .use(remarkCallouts)
    // Convert to HTML AST
    .use(remarkRehype, { allowDangerousHtml: true })
    // Add slugs to headings for linking
    .use(rehypeSlug)
    // Extract TOC from headings
    .use(() => rehypeExtractToc(toc))
    // Syntax highlighting for code blocks
    .use(rehypeHighlight, { detect: true })
    // Wrap code blocks with copy button UI
    .use(rehypeCodeBlocks)
    // Convert to HTML string
    .use(rehypeStringify, { allowDangerousHtml: true })
  
  // Process the markdown
  const result = await processor.process(mdContent)
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
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

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
