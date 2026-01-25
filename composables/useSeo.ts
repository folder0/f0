/**
 * =============================================================================
 * F0 - SEO COMPOSABLE
 * =============================================================================
 * 
 * Handles SEO meta tags for pages.
 * 
 * USAGE:
 * ```vue
 * useSeo({
 *   title: 'Page Title',
 *   description: 'Page description',
 *   image: '/og-image.png'
 * })
 * ```
 */

interface SeoOptions {
  title?: string
  description?: string
  image?: string
  type?: 'website' | 'article'
  noIndex?: boolean
}

/**
 * SEO composable
 */
export function useSeo(options: SeoOptions = {}) {
  const config = useRuntimeConfig()
  const route = useRoute()
  
  const siteName = config.public.siteName || 'LiteDocs'
  const siteDescription = config.public.siteDescription || 'Documentation'
  
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
  
  // Set meta tags
  useHead({
    title: title.value,
    meta: [
      { name: 'description', content: description.value },
      
      // Open Graph
      { property: 'og:title', content: title.value },
      { property: 'og:description', content: description.value },
      { property: 'og:type', content: options.type || 'website' },
      { property: 'og:site_name', content: siteName },
      
      // Twitter
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title.value },
      { name: 'twitter:description', content: description.value },
      
      // Robots
      ...(options.noIndex ? [{ name: 'robots', content: 'noindex, nofollow' }] : []),
    ],
  })
  
  return {
    title,
    description,
  }
}
