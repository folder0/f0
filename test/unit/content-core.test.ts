import { describe, expect, it } from 'vitest'
import {
  blankOutCode,
  fileToUrlPath,
  firstHeading,
  isDraft,
  readFrontmatter,
  resolveAssetUrl,
  resolvePageTitle,
  stripOrderPrefix,
  titleFromFileName,
  urlNamesFor,
} from '../../server/utils/content-core'

describe('readFrontmatter', () => {
  it('reads a normal block', () => {
    const doc = readFrontmatter('---\ntitle: Hello\norder: 2\ntags: [a, b]\n---\n\n# Body\n')
    expect(doc.data).toEqual({ title: 'Hello', order: 2, tags: ['a', 'b'] })
    expect(doc.body).toBe('\n# Body\n')
    expect(doc.hasFrontmatter).toBe(true)
  })

  it('handles CRLF line endings and a UTF-8 BOM', () => {
    expect(readFrontmatter('---\r\ntitle: Windows\r\n---\r\nBody\r\n').data.title).toBe('Windows')
    expect(readFrontmatter('﻿---\ntitle: Bom\n---\nBody\n').data.title).toBe('Bom')
    expect(readFrontmatter('---\r\ntitle: Windows\r\n---\r\nBody\r\n').body).toBe('Body\n')
  })

  it('treats empty and comment-only blocks as frontmatter with no keys', () => {
    for (const source of ['---\n---\nBody', '---\n\n---\nBody', '---\n# SEO notes\n---\nBody']) {
      const doc = readFrontmatter(source)
      expect(doc.data).toEqual({})
      expect(doc.hasFrontmatter).toBe(true)
      expect(doc.body).toBe('Body')
    }
  })

  it('accepts a block without a final newline', () => {
    expect(readFrontmatter('---\ntitle: X\n---').data.title).toBe('X')
  })

  it('requires the closing delimiter at the start of a line', () => {
    expect(readFrontmatter('---\ntitle: a---\nmore: b\n---\n').data).toEqual({ title: 'a---', more: 'b' })
  })

  it('keeps invalid or non-mapping blocks as content', () => {
    const invalid = readFrontmatter('---\ntitle: [unclosed\n---\nBody')
    expect(invalid.hasFrontmatter).toBe(false)
    expect(invalid.body).toContain('title: [unclosed')
    expect(invalid.error).toBeTruthy()

    const rule = readFrontmatter('---\nJust a sentence between rules.\n---\nBody')
    expect(rule.hasFrontmatter).toBe(false)
    expect(rule.body).toContain('Just a sentence')
  })

  it('leaves documents without frontmatter alone', () => {
    expect(readFrontmatter('# Title\n\nBody').body).toBe('# Title\n\nBody')
  })
})

describe('isDraft', () => {
  it.each([true, 1, 'true', 'yes', 'Yes', 'on', 'y', ' TRUE '])('treats %j as a draft', (value) => {
    expect(isDraft({ draft: value })).toBe(true)
  })

  it.each([false, 0, 'false', 'no', '', undefined, null, 'maybe'])('treats %j as published', (value) => {
    expect(isDraft({ draft: value })).toBe(false)
  })
})

describe('titles', () => {
  it('finds the first H1 outside code fences', () => {
    expect(firstHeading('```bash\n# not a title\n```\n\n# Real Title\n')).toBe('Real Title')
    expect(firstHeading('~~~\n# no\n~~~\n# Yes ##\n')).toBe('Yes')
    expect(firstHeading('## Only H2\n')).toBeNull()
    expect(firstHeading('#hashtag\n')).toBeNull()
  })

  it('derives a readable name from a file name', () => {
    expect(titleFromFileName('01-getting-started.md')).toBe('Getting Started')
    expect(titleFromFileName('2026-02-11-release-notes.md')).toBe('Release Notes')
    expect(titleFromFileName('/abs/path/to/no-title.md')).toBe('No Title')
    expect(titleFromFileName('v1.2')).toBe('V1.2')
    expect(titleFromFileName('03-getting-started')).toBe('Getting Started')
  })

  it('resolves frontmatter title, then H1, then file name', () => {
    expect(resolvePageTitle(readFrontmatter("---\nsubtitle: Sub\ntitle: Don't Panic\n---\n# H1\n"), 'x.md')).toBe("Don't Panic")
    expect(resolvePageTitle(readFrontmatter('---\norder: 2\n---\n# Install Guide\n'), '02-setup.md')).toBe('Install Guide')
    expect(resolvePageTitle(readFrontmatter('---\n# SEO block\n---\n\nText only\n'), 'guides/empty-fm.md')).toBe('Empty Fm')
    expect(resolvePageTitle(readFrontmatter('---\ntitle: 2024\n---\n'), 'x.md')).toBe('2024')
  })
})

describe('URLs', () => {
  it('strips date and number prefixes', () => {
    expect(stripOrderPrefix('2026-02-11-hello')).toBe('hello')
    expect(stripOrderPrefix('01-intro')).toBe('intro')
    expect(stripOrderPrefix('2026-01-05-01-x')).toBe('x')
    expect(stripOrderPrefix('v2-api')).toBe('v2-api')
  })

  it.each([
    ['guides/01-intro.md', '/guides/intro'],
    ['01-guides/02-setup.md', '/guides/setup'],
    ['blog/2026-02-11-hello.md', '/blog/hello'],
    ['2026-02-11-root.md', '/root'],
    ['guides/index.md', '/guides'],
    ['index.md', '/index'],
    ['home.md', '/'],
    ['guides/home.md', '/guides/home'],
    ['guides/foo.mdx', '/guides/foo'],
    ['api/petstore.json', '/api/petstore'],
    ['guides\\windows.md', '/guides/windows'],
  ])('%s → %s', (file, url) => {
    expect(fileToUrlPath(file)).toBe(url)
  })

  it('lists the names a file answers to, canonical first', () => {
    expect(urlNamesFor('2026-02-11-hello')).toEqual(['hello', '2026-02-11-hello', '02-11-hello'])
    expect(urlNamesFor('01-intro')).toEqual(['intro', '01-intro'])
    expect(urlNamesFor('plain')).toEqual(['plain'])
  })
})

describe('resolveAssetUrl', () => {
  it.each([
    ['./assets/images/a.png', '/api/content/assets/images/a.png'],
    ['assets/images/a.png', '/api/content/assets/images/a.png'],
    ['images/a.png', '/api/content/assets/images/a.png'],
    ['./images/a.png', '/api/content/assets/images/a.png'],
    ['/api/content/assets/a.png', '/api/content/assets/a.png'],
    ['/assets/a.png', '/assets/a.png'],
    ['https://cdn.example.com/a.png', 'https://cdn.example.com/a.png'],
    ['//cdn.example.com/a.png', '//cdn.example.com/a.png'],
    ['data:image/png;base64,AAAA', 'data:image/png;base64,AAAA'],
    ['../outside.png', '../outside.png'],
    ['./assets/../../x.png', './assets/../../x.png'],
  ])('%s → %s', (input, output) => {
    expect(resolveAssetUrl(input)).toBe(output)
  })
})

describe('blankOutCode', () => {
  it('blanks fenced and inline code but keeps positions', () => {
    const source = 'Text ![a](x.png)\n```md\n![b](y.png)\n```\nand `![c](z.png)` end'
    const blanked = blankOutCode(source)
    expect(blanked.length).toBe(source.length)
    expect(blanked.split('\n').length).toBe(source.split('\n').length)
    expect(blanked).toContain('![a](x.png)')
    expect(blanked).not.toContain('y.png')
    expect(blanked).not.toContain('z.png')
    expect(blanked).toContain(' end')
  })
})
