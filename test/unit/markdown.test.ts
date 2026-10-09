/**
 * Characterization tests for the markdown pipeline.
 *
 * These lock in behaviour that existing sites depend on, so later changes
 * (sanitizer, directive engine, pipeline refactor) can prove they did not move
 * it. In particular, heading anchor ids are a public contract: external links
 * deep-link to them.
 */
import { describe, expect, it } from 'vitest'
import {
  escapeHtml,
  extractFrontmatter,
  markdownToPlainText,
  parseMarkdown,
  slugify,
} from '../../server/utils/markdown'

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#039;s&lt;/a&gt;',
    )
  })
})

describe('slugify', () => {
  it('lowercases, strips punctuation and collapses separators', () => {
    expect(slugify('  Getting Started: The Basics!  ')).toBe('getting-started-the-basics')
    expect(slugify('snake_case and--dashes')).toBe('snake-case-and-dashes')
  })
})

describe('extractFrontmatter', () => {
  it('parses YAML frontmatter and returns the body without it', () => {
    const { frontmatter, content } = extractFrontmatter('---\ntitle: Hello\norder: 2\n---\n# Body\n')
    expect(frontmatter).toEqual({ title: 'Hello', order: 2 })
    expect(content).toBe('# Body\n')
  })

  it('returns an empty object when there is no frontmatter', () => {
    const { frontmatter, content } = extractFrontmatter('# Just a heading\n')
    expect(frontmatter).toEqual({})
    expect(content).toBe('# Just a heading\n')
  })
})

describe('parseMarkdown', () => {
  it('assigns github-slugger heading ids, including duplicate suffixes', async () => {
    const { html } = await parseMarkdown('## Getting Started\n\n## Getting Started\n\n### API & Auth\n')
    expect(html).toContain('<h2 id="getting-started">')
    expect(html).toContain('<h2 id="getting-started-1">')
    expect(html).toContain('<h3 id="api--auth">')
  })

  it('builds a two-level table of contents from h2 and h3', async () => {
    const { toc } = await parseMarkdown('## One\n\n### One A\n\n## Two\n')
    expect(toc).toEqual([
      { id: 'one', text: 'One', level: 2, children: [{ id: 'one-a', text: 'One A', level: 3, children: [] }] },
      { id: 'two', text: 'Two', level: 2, children: [] },
    ])
  })

  it('takes the title from frontmatter, then the first H1', async () => {
    expect((await parseMarkdown('---\ntitle: From FM\n---\n# From H1\n')).title).toBe('From FM')
    expect((await parseMarkdown('# From H1\n\ntext\n')).title).toBe('From H1')
  })

  it('renders callouts with their type class', async () => {
    const { html } = await parseMarkdown(':::warning\nCareful **now**.\n:::\n')
    expect(html).toContain('<div class="callout callout-warning">')
    expect(html).toContain('<strong>now</strong>')
  })

  it('wraps fenced code in a code block with a language label', async () => {
    const { html } = await parseMarkdown('```ts\nconst a = 1\n```\n')
    expect(html).toContain('<div class="code-block">')
    expect(html).toContain('<span class="code-block-language">ts</span>')
  })

  it('rewrites ./assets image paths to the content asset endpoint with a WebP srcset', async () => {
    const { html } = await parseMarkdown('![Diagram](./assets/images/flow.png)\n')
    // rehype-stringify encodes '&' in attribute values as '&#x26;'
    expect(html).toContain('/api/content/assets/images/flow.png?w=400&#x26;f=webp 400w')
    expect(html).toContain('src="/api/content/assets/images/flow.png?w=800"')
    expect(html).toContain('alt="Diagram"')
  })
})

describe('directives and code fences', () => {
  it('renders an image right after a callout as an image, not literal text', async () => {
    const { html } = await parseMarkdown(':::info\nNote.\n:::\n\n![Pixel](./assets/images/pixel.png)\n')
    expect(html).toContain('class="callout callout-info"')
    expect(html).toContain('<img src="/api/content/assets/images/pixel.png')
    expect(html).not.toContain('![Pixel]')
  })

  it('leaves directive syntax inside code fences alone', async () => {
    const source = 'Example:\n\n```markdown\n:::warning\nCareful.\n:::\n\n::embed[Demo]{url=https://example.com}\n```\n'
    const { html } = await parseMarkdown(source)
    expect(html).not.toContain('class="callout')
    expect(html).not.toContain('embed-card')
    expect(html).toContain(':::warning')
    expect(html).toContain('::embed[Demo]{url=https://example.com}')
  })

  it('still renders a callout that contains a code fence', async () => {
    const { html } = await parseMarkdown(':::tip\nRun:\n\n```bash\nnpm install\n```\n:::\n')
    expect(html).toContain('class="callout callout-tip"')
    expect(html).toContain('npm install')
  })

  it('leaves tilde fences and longer fences alone too', async () => {
    const { html } = await parseMarkdown('~~~\n:::info\nx\n:::\n~~~\n\n````md\n```\n:::note\ny\n:::\n```\n````\n')
    expect(html).not.toContain('class="callout')
  })
})

describe('markdownToPlainText', () => {
  it('keeps identifiers, globs and code intact', () => {
    const text = markdownToPlainText('Set `NUXT_PUBLIC_SITE_NAME` and NUXT_JWT_SECRET for snake_case files like *.md and *.json.\n\n```bash\n# install deps\nnpm i\n```\n')
    expect(text).toContain('NUXT_PUBLIC_SITE_NAME')
    expect(text).toContain('NUXT_JWT_SECRET')
    expect(text).toContain('snake_case')
    expect(text).toContain('*.md and *.json')
    expect(text).toContain('# install deps')
    expect(text).not.toMatch(/install deps\n=+/)
  })

  it('still strips emphasis, headings and directive markers', () => {
    const text = markdownToPlainText('# Title\n\nSome **bold**, *em*, _it_ and __strong__ text.\n\n:::info\nNote\n:::\n')
    expect(text).toContain('Title\n=====')
    expect(text).toContain('Some bold, em, it and strong text.')
    expect(text).not.toContain(':::')
  })
})
