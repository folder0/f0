#!/usr/bin/env node
/**
 * =============================================================================
 * F0 ACCESS TOKENS — long-lived tokens for tools on private sites
 * =============================================================================
 *
 *   npm run token -- create --email ana@acme.com --name claude-desktop [--days 365]
 *   npm run token -- list
 *   npm run token -- revoke --name claude-desktop
 *
 * Options: --private <dir> (default ./private, or NUXT_PRIVATE_DIR / PRIVATE_DIR)
 *
 * `create` prints the token once; only its SHA-256 hash is written to
 * <private>/tokens.json. Use it as "Authorization: Bearer <token>", e.g. for
 * the /mcp endpoint. A token works only while its email is on the allowlist.
 * Commit tokens.json with the site (it holds no secrets) or edit it in place;
 * changes apply on the next request.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PREFIX = 'f0_pat_'

function option(args, name) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

function load(path) {
  if (!existsSync(path)) return { tokens: [] }
  const data = JSON.parse(readFileSync(path, 'utf-8'))
  return { ...data, tokens: Array.isArray(data.tokens) ? data.tokens : [] }
}

function save(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
}

function fail(message) {
  console.error(message)
  process.exit(2)
}

const [command, ...args] = process.argv.slice(2)
const privateDir = resolve(option(args, 'private') || process.env.NUXT_PRIVATE_DIR || process.env.PRIVATE_DIR || './private')
const file = join(privateDir, 'tokens.json')

if (command === 'create') {
  const email = option(args, 'email')?.trim().toLowerCase()
  const name = option(args, 'name')?.trim()
  const days = Number(option(args, 'days') ?? 365)
  if (!email || !email.includes('@') || !name) fail('Usage: create --email <allowlisted email> --name <label> [--days 365]')
  if (!Number.isInteger(days) || days < 1 || days > 3650) fail('--days must be between 1 and 3650')

  const data = load(file)
  if (data.tokens.some(t => t.name === name)) fail(`A token named "${name}" exists; revoke it first or pick another name`)

  const token = PREFIX + randomBytes(32).toString('base64url')
  const today = new Date()
  const expires = new Date(today.getTime() + days * 86_400_000)
  data.tokens.push({
    name,
    email,
    hash: createHash('sha256').update(token).digest('hex'),
    created: today.toISOString().slice(0, 10),
    expires: expires.toISOString().slice(0, 10),
  })
  mkdirSync(privateDir, { recursive: true })
  save(file, data)
  console.log(`Created "${name}" for ${email}, valid until ${expires.toISOString().slice(0, 10)}.`)
  console.log('Copy it now; it is not stored and cannot be shown again:\n')
  console.log(token)
}
else if (command === 'list') {
  const { tokens } = load(file)
  if (tokens.length === 0) console.log(`No tokens in ${file}`)
  for (const t of tokens) console.log(`${t.name}\t${t.email}\tcreated ${t.created ?? '?'}\texpires ${t.expires ?? 'never'}`)
}
else if (command === 'revoke') {
  const name = option(args, 'name')
  if (!name) fail('Usage: revoke --name <label>')
  const data = load(file)
  const remaining = data.tokens.filter(t => t.name !== name)
  if (remaining.length === data.tokens.length) fail(`No token named "${name}"`)
  save(file, { ...data, tokens: remaining })
  console.log(`Revoked "${name}". It stops working on the next request.`)
}
else {
  fail('Usage: npm run token -- create|list|revoke [options] (see bin/f0-token.mjs)')
}
