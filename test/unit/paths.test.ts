import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasHiddenSegment, resolveContentSubdir } from '../../server/utils/paths'

let root: string
let content: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'f0-paths-'))
  content = join(root, 'content')
  mkdirSync(join(content, 'blog'), { recursive: true })
  mkdirSync(join(content, 'guides/changelog'), { recursive: true })
  mkdirSync(join(root, 'outside'))
  writeFileSync(join(root, 'outside/secret.md'), '# secret')
  symlinkSync(join(root, 'outside'), join(content, 'escape'))
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('hasHiddenSegment', () => {
  it('flags dot and underscore segments anywhere in a slug', () => {
    expect(hasHiddenSegment('blog/_config')).toBe(true)
    expect(hasHiddenSegment('_brand')).toBe(true)
    expect(hasHiddenSegment('guides/.notes/x')).toBe(true)
    expect(hasHiddenSegment('guides/getting-started')).toBe(false)
    expect(hasHiddenSegment('')).toBe(false)
  })
})

describe('resolveContentSubdir', () => {
  it('resolves the root and nested directories', async () => {
    expect(await resolveContentSubdir(content, undefined)).toMatchObject({ ok: true, rel: '', exists: true })
    expect(await resolveContentSubdir(content, '/blog')).toMatchObject({ ok: true, rel: 'blog', exists: true })
    expect(await resolveContentSubdir(content, 'guides/changelog/')).toMatchObject({ ok: true, rel: 'guides/changelog', exists: true })
  })

  it('reports a well-formed missing directory as ok but absent', async () => {
    expect(await resolveContentSubdir(content, '/no-such-dir')).toMatchObject({ ok: true, rel: 'no-such-dir', exists: false })
  })

  it.each(['..', '../outside', 'blog/../..', '.', '_drafts', 'blog/_partials', '.git'])('rejects %s', async (value) => {
    expect((await resolveContentSubdir(content, value)).ok).toBe(false)
  })

  it('rejects backslashes, NUL bytes and non-string values', async () => {
    expect((await resolveContentSubdir(content, '..\\outside')).ok).toBe(false)
    expect((await resolveContentSubdir(content, 'blog\0')).ok).toBe(false)
    expect((await resolveContentSubdir(content, ['blog', 'guides'])).ok).toBe(false)
  })

  it('rejects symlinks that escape the content directory', async () => {
    expect(await resolveContentSubdir(content, 'escape')).toMatchObject({ ok: false, reason: 'outside content directory' })
  })
})
