/**
 * =============================================================================
 * F0 - SEO COMPOSABLE
 * =============================================================================
 * 
 * Handles OpenGraph, Twitter Card, and standard meta tags for pages.
 * 
 * Image resolution order for og:image:
 * 1. Frontmatter cover_image (blog posts)
 * 2. _brand.md og_image (site-wide default)
 * 3. No image (acceptable fallback)
 * 
 * USAGE:
 * ```vue
 * // Static options:
 * useSeo({ title: 'Page Title', description: 'Page description' })
 *
 * // Reactive options (recommended when the values depend on async data) —
 * // pass a getter and call useSeo ONCE in setup; the head stays in sync
 * // without re-invoking the composable:
 * useSeo(() => ({
 *   title: content.value?.title,
 *   description: content.value?.description,
 *   type: content.value?.layout === 'blog' ? 'article' : 'website',
 * }))
 * ```
 */

interface SeoOptions {
  title?: string
  description?: string
  image?: string
  type?: 'website' | 'article'
  noIndex?: boolean
  /** ISO date string for article published time */
  publishedTime?: string
  /** Author name for article meta */
  author?: string
  /** Tags for article meta */
  tags?: string[]
}

/**
 * SEO composable — injects OG, Twitter, and standard meta tags.
 */
export function useSeo(input: SeoOptions | (() => SeoOptions) = {}) {
  const config = useRuntimeConfig()
  const route = useRoute()

  const siteName = config.public.siteName || 'f0'
  const siteDescription = config.public.siteDescription || 'Documentation'
  const siteUrl = config.public.siteUrl || ''

  // Accept either a static options object or a reactive getter. Normalising to
  // a getter lets every derived value be a `computed`, so useHead can be
  // registered ONCE and stay reactive — no need to re-invoke useSeo when async
  // content arrives (which previously caused duplicate head registrations).
  const getOptions = typeof input === 'function' ? input : () => input

  // Build title
  const title = computed(() => {
    const options = getOptions()
    if (options.title) {
      return `${options.title} | ${siteName}`
    }
    return siteName
  })

  // Build description
  const description = computed(() => getOptions().description || siteDescription)

  // Canonical URL
  const canonicalUrl = computed(() => {
    if (!siteUrl) return ''
    return `${siteUrl}${route.path}`
  })

  // Resolve OG image: explicit → brand og_image (the layout fetches the brand
  // under the 'brand' key; read it from the payload, no extra request)
  const { data: brand } = useNuxtData<{ ogImage?: string }>('brand')
  const ogImage = computed(() => getOptions().image || brand.value?.ogImage || '')

  // og:image must be absolute: the site URL, else this request's origin
  const requestOrigin = useRequestURL().origin

  // Build meta array
  const meta = computed(() => {
    const options = getOptions()
    const tags: Record<string, string>[] = [
      { name: 'description', content: description.value },

      // Open Graph
      { property: 'og:title', content: title.value },
      { property: 'og:description', content: description.value },
      { property: 'og:type', content: options.type || 'website' },
      { property: 'og:site_name', content: siteName },

      // Twitter Card
      { name: 'twitter:card', content: ogImage.value ? 'summary_large_image' : 'summary' },
      { name: 'twitter:title', content: title.value },
      { name: 'twitter:description', content: description.value },
    ]

    // Canonical URL
    if (canonicalUrl.value) {
      tags.push({ property: 'og:url', content: canonicalUrl.value })
    }

    // OG Image
    if (ogImage.value) {
      const imageUrl = /^https?:\/\//.test(ogImage.value)
        ? ogImage.value
        : `${(siteUrl || requestOrigin).replace(/\/$/, '')}${ogImage.value.startsWith('/') ? '' : '/'}${ogImage.value}`
      tags.push({ property: 'og:image', content: imageUrl })
      tags.push({ name: 'twitter:image', content: imageUrl })
    }

    // Article-specific meta
    if (options.type === 'article') {
      if (options.publishedTime) {
        tags.push({ property: 'article:published_time', content: options.publishedTime })
      }
      if (options.author) {
        tags.push({ property: 'article:author', content: options.author })
      }
      if (options.tags?.length) {
        for (const tag of options.tags) {
          tags.push({ property: 'article:tag', content: tag })
        }
      }
    }

    // Robots
    if (getOptions().noIndex) {
      tags.push({ name: 'robots', content: 'noindex, nofollow' })
    }

    return tags
  })

  const link = computed(() =>
    canonicalUrl.value ? [{ rel: 'canonical', href: canonicalUrl.value }] : []
  )

  // Register once with reactive refs so the head updates as inputs change.
  useHead({
    title,
    meta,
    link,
  })

  return {
    title,
    description,
  }
}
