/**
 * =============================================================================
 * F0 - REAL-USER METRICS ENDPOINT
 * =============================================================================
 *
 * POST /api/rum  (only when NUXT_PUBLIC_RUM=true; otherwise 404)
 *
 * Accepts one Core Web Vitals measurement from plugins/rum.client.ts and
 * writes it to the log as {"msg":"rum","name":"LCP","value":1830,...}.
 * CLS is reported in thousandths. Bodies are capped, every field is
 * validated, and the log rate is capped so the endpoint cannot flood logs.
 */

import { logger } from '../utils/logger'

const METRICS = new Set(['LCP', 'INP', 'CLS', 'FCP', 'TTFB'])
const RATINGS = new Set(['good', 'needs-improvement', 'poor'])
const MAX_BODY_BYTES = 1024
const MAX_EVENTS_PER_SECOND = 50

let windowStart = 0
let windowCount = 0

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig().public
  if (String(config.rum) !== 'true') {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }

  if (Number(getHeader(event, 'content-length') || 0) > MAX_BODY_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  }
  const raw = await readRawBody(event, 'utf8')
  if (!raw || raw.length > MAX_BODY_BYTES) {
    throw createError({ statusCode: raw ? 413 : 400, statusMessage: raw ? 'Payload Too Large' : 'Bad Request' })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }

  const { name, value, rating, navigationType, path } = body
  if (
    typeof name !== 'string' || !METRICS.has(name)
    || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 600_000
    || typeof rating !== 'string' || !RATINGS.has(rating)
    || typeof path !== 'string' || !path.startsWith('/') || path.length > 300
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }

  const now = Date.now()
  if (now - windowStart >= 1000) {
    windowStart = now
    windowCount = 0
  }
  if (++windowCount <= MAX_EVENTS_PER_SECOND) {
    logger.info('rum', {
      name,
      value: Math.round(value),
      rating,
      navigationType: typeof navigationType === 'string' ? navigationType.slice(0, 20) : undefined,
      path: path.split(/[?#]/)[0],
    })
  }

  setResponseStatus(event, 204)
  return null
})
