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
 * useSeo({
 *   title: 'Page Title',
 *   description: 'Page description',
 *   image: '/og-image.png',
 *   type: 'article',
 *   publishedTime: '2026-01-15',
 *   author: 'Jane Doe',
 *   tags: ['guide', 'auth']
 * })
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
export function useSeo(options: SeoOptions = {}) {
  const config = useRuntimeConfig()
  const route = useRoute()
  
  const siteName = config.public.siteName || 'f0'
  const siteDescription = config.public.siteDescription || 'Documentation'
  const siteUrl = config.public.siteUrl || ''
  
  // Build title
  const title = computed(() => {
    if (options.title) {
      return `${options.title} | ${siteName}`
    }
    return siteName
  })
  
  // Build description
  const description = computed(() => {
    return options.description || siteDescription
  })
  
  // Canonical URL
  const canonicalUrl = computed(() => {
    if (!siteUrl) return ''
    return `${siteUrl}${route.path}`
  })
  
  // Resolve OG image: explicit → brand default
  const ogImage = computed(() => {
    if (options.image) return options.image
    // Brand default is fetched by the layout; we can't access it here without
    // an extra fetch, so we leave it empty — the layout's useHead will inject
    // the brand og_image if available.
    return ''
  })
  
  // Build meta array
  const meta = computed(() => {
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
      const imageUrl = ogImage.value.startsWith('http')
        ? ogImage.value
        : siteUrl ? `${siteUrl}${ogImage.value}` : ogImage.value
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
    if (options.noIndex) {
      tags.push({ name: 'robots', content: 'noindex, nofollow' })
    }
    
    return tags
  })
  
  // Set head
  useHead({
    title: title.value,
    meta: meta.value,
    link: canonicalUrl.value
      ? [{ rel: 'canonical', href: canonicalUrl.value }]
      : [],
  })
  
  return {
    title,
    description,
  }
}
