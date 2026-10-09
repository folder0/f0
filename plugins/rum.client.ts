/**
 * =============================================================================
 * F0 - REAL-USER METRICS (opt-in)
 * =============================================================================
 *
 * With NUXT_PUBLIC_RUM=true, each sampled page load reports its Core Web
 * Vitals (LCP, INP, CLS, plus FCP and TTFB) to POST /api/rum, which writes
 * one structured log line per metric. No cookies, no third parties, no query
 * strings. The library loads after the page, so it never adds to the initial
 * JavaScript.
 */

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public
  const enabled = String(config.rum) === 'true'
  if (!enabled) return

  const sample = Number(config.rumSample)
  if (Number.isFinite(sample) && Math.random() >= sample) return

  const router = useRouter()

  const send = (metric: { name: string, value: number, rating: string, navigationType?: string }) => {
    const body = JSON.stringify({
      name: metric.name,
      value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
      rating: metric.rating,
      navigationType: metric.navigationType,
      path: router.currentRoute.value.path,
    })
    if (!navigator.sendBeacon?.('/api/rum', new Blob([body], { type: 'application/json' }))) {
      fetch('/api/rum', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {})
    }
  }

  onNuxtReady(async () => {
    const { onCLS, onFCP, onINP, onLCP, onTTFB } = await import('web-vitals')
    onLCP(send)
    onINP(send)
    onCLS(send)
    onFCP(send)
    onTTFB(send)
  })
})
