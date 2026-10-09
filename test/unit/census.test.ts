import { describe, expect, it } from 'vitest'
import { census } from '../../bin/f0-census.mjs'

describe('f0 census on the edge-case fixture', () => {
  const report = census('test/fixtures/edge-site/content')

  it('lists drafts that leave the listings, including draft: yes', () => {
    expect(report.draftsNowHidden.map((d: { file: string }) => d.file)).toEqual(['blog/2026-03-01-draft.md', 'guides/draft-true.md', 'guides/draft-yes.md'])
    expect(report.draftsNowRespected.map((d: { file: string }) => d.file)).toEqual(['guides/draft-yes.md'])
  })

  it('lists configs, URLs and titles that change', () => {
    expect(report.nestedConfigs.map((c: { file: string }) => c.file)).toEqual(['guides/changelog/_config.md'])
    expect(report.sitemapUrlChanges).toContainEqual({ file: '02-reference/01-api-basics.md', before: '/02-reference/api-basics', after: '/reference/api-basics' })
    expect(report.titleChanges).toContainEqual({ file: 'guides/crlf.md', before: 'Windows Heading', after: 'Windows File' })
    expect(report.titleChanges.map((t: { file: string }) => t.file)).not.toContain('guides/subtitle.md')
  })

  it('lists pages that rendered as errors and broken cover images', () => {
    expect(report.pagesThatErrored.map((p: { file: string }) => p.file)).toEqual(['blog/2026-04-01-null-fm.md', 'guides/empty-fm.md'])
    expect(report.coverImageFixes).toEqual([{ file: 'blog/2026-02-11-foo.md', cover_image: './assets/images/cover.png', now: '/api/content/assets/images/cover.png' }])
  })
})
