<!--
  =============================================================================
  F0 - DOCUMENTATION PAGE (Catch-All Route)
  =============================================================================
  
  This page handles all documentation routes:
  /guides/getting-started → Renders /content/guides/getting-started.md
  /api/users             → Renders /content/api/users.json (if OpenAPI/Postman)
  
  It fetches content from the API and renders it appropriately:
  - Markdown files → MarkdownRenderer component
  - OpenAPI/Postman JSON → ApiDocViewer component
-->

<template>
  <div class="doc-page">
    <!-- Loading state -->
    <div v-if="pending" class="loading">
      <div class="loading-spinner" />
      <p>Loading content...</p>
    </div>
    
    <!-- Error state (404) — or Blog Index -->
    <div v-else-if="error && !isBlogIndex" class="error-page">
      <h1>Page Not Found</h1>
      <p>The requested documentation page could not be found.</p>
      <p class="error-path">{{ route.path }}</p>
      <NuxtLink to="/" class="btn btn-primary">Go to Home</NuxtLink>
    </div>
    
    <!-- Blog Index (when path is a blog directory root) -->
    <BlogIndex v-else-if="isBlogIndex" :path="blogIndexPath" />
    
    <!-- Content -->
    <article v-else class="content">
      <!-- Drafts are reachable by URL only: say so to whoever has the link -->
      <p v-if="content?.draft" class="draft-banner" role="note">
        Draft: this page is not listed in navigation, search or the sitemap, and search engines are asked not to index it.
      </p>

      <!-- Blog post layout -->
      <BlogPostLayout
        v-if="content?.layout === 'blog' && content?.type === 'markdown'"
        :content="content"
      />
      
      <!-- Markdown content (docs layout) -->
      <ContentMarkdownRenderer 
        v-else-if="content?.type === 'markdown'"
        :html="content.html ?? ''" 
        :toc="content.toc"
        :title="content.title"
        :markdown="content.markdown"
        :path="content.path"
        :chrome="content.chrome"
        :footer-html="content.footerHtml"
      />
      
      <!-- API documentation (OpenAPI/Postman) -->
      <ContentApiDocViewer
        v-else-if="content?.type === 'openapi' || content?.type === 'postman'"
        :spec="{ ...content.spec!, rawSpec: content.rawSpec ?? '' }"
      />
      
      <!-- Unknown type fallback -->
      <div v-else class="unknown-content">
        <h1>{{ content?.title || 'Documentation' }}</h1>
        <p>This content type is not yet supported.</p>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import type { TocItem } from '~/server/utils/markdown'
import type { ApiSpec } from '~/server/utils/openapi-parser'

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface ContentResponse {
  type: 'markdown' | 'openapi' | 'postman'
  title: string
  description?: string
  html?: string
  toc?: TocItem[]
  spec?: ApiSpec
  markdown?: string  // Raw markdown for copy feature
  path?: string      // Page path for download feature
  layout?: 'docs' | 'blog'
  draft?: boolean
  footerHtml?: string
  chrome?: {
    breadcrumbs: { title: string, path: string | null }[]
    prev: { title: string, path: string | null } | null
    next: { title: string, path: string | null } | null
    editUrl: string | null
  }
  rawSpec?: string   // Original spec file, for the download button
  blog?: {
    date: string
    author: string
    tags: string[]
    coverImage?: string
    excerpt: string
    pinned: boolean
    readingTime: number
    prev?: { title: string, path: string } | null
    next?: { title: string, path: string } | null
  }
}

// ---------------------------------------------------------------------------
// ROUTE
// ---------------------------------------------------------------------------

const route = useRoute()
const slug = computed(() => {
  const params = route.params.slug
  if (Array.isArray(params)) {
    return params.join('/')
  }
  return params || ''
})

// ---------------------------------------------------------------------------
// FETCH CONTENT
// ---------------------------------------------------------------------------

const { data: content, pending, error } = await useFetch<ContentResponse>(
  () => `/api/content/${slug.value}`,
  {
    watch: [slug],
    // Only what the page uses goes into the HTML payload (frontmatter is
    // already reflected in title, blog and draft)
    pick: ['type', 'title', 'description', 'html', 'toc', 'spec', 'rawSpec', 'markdown', 'path', 'layout', 'draft', 'blog', 'chrome', 'footerHtml'],
    // Suppress 404 console noise — blog directories legitimately 404 here
    onResponseError({ response }) {
      if (response.status !== 404) {
        console.error('[f0] Content fetch error:', response.status)
      }
    },
  }
)

// ---------------------------------------------------------------------------
// BLOG INDEX DETECTION
// ---------------------------------------------------------------------------
// If content 404s, check if this path is a blog directory root
// If so, render BlogIndex instead of the error page. Awaited, so the server
// renders the blog index (it used to render "Page Not Found" and let the
// browser swap it in).

const blogIndexPath = computed(() => '/' + slug.value)
const requestFetch = useRequestFetch()

const { data: blogIndexCheck } = await useAsyncData(
  () => `blog-index:${slug.value}`,
  async () => {
    if (!error.value || error.value.statusCode !== 404) return false
    try {
      const blogCheck = await requestFetch<{ config: { layout: string } }>('/api/blog', {
        query: { path: slug.value },
      })
      return blogCheck?.config?.layout === 'blog'
    } catch {
      // Not a blog directory, show normal error
      return false
    }
  },
  { watch: [error] },
)
const isBlogIndex = computed(() => blogIndexCheck.value === true)

// A missing page answers 404 (it answered 200 with a "Page Not Found" body)
if (import.meta.server && error.value && !isBlogIndex.value) {
  const status = error.value.statusCode && error.value.statusCode >= 400 && error.value.statusCode < 500
    ? error.value.statusCode
    : 404
  setResponseStatus(useRequestEvent()!, status, status === 404 ? 'Not Found' : undefined)
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

// Reactive: registered once, stays in sync as content loads/changes.
useSeo(() => ({
  title: content.value?.title,
  description: content.value?.blog?.excerpt || content.value?.description,
  image: content.value?.blog?.coverImage,
  type: content.value?.layout === 'blog' ? 'article' : 'website',
  publishedTime: content.value?.blog?.date,
  author: content.value?.blog?.author,
  tags: content.value?.blog?.tags,
  noIndex: content.value?.draft === true,
}))

// Advertise the page's Markdown source (same URL + .md) to agents and tools
useHead(computed(() => (content.value?.type === 'markdown'
  ? { link: [{ rel: 'alternate', type: 'text/markdown', href: `${route.path.replace(/\/$/, '')}.md` }] }
  : {})))

// Drafts also carry the header form, for crawlers that skip meta tags
if (import.meta.server && content.value?.draft) {
  useResponseHeader('X-Robots-Tag').value = 'noindex'
}

// ---------------------------------------------------------------------------
// TOC INJECTION
// ---------------------------------------------------------------------------

// Get TOC setter from composable
const { setTocItems } = useToc()

// Update TOC when content loads
// Blog posts hide TOC by default (can be overridden via _config.md show_toc)
watch(content, (newContent) => {
  if (newContent?.layout === 'blog') {
    // Blog posts don't show TOC by default
    setTocItems([])
  } else if (newContent?.toc) {
    setTocItems(newContent.toc)
  } else {
    setTocItems([])
  }
}, { immediate: true })
</script>

<style scoped>
.doc-page {
  min-height: 400px;
}

.draft-banner {
  margin: 0 0 var(--spacing-6, 1.5rem);
  padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
  border-left: 3px solid var(--color-warning);
  border-radius: 6px;
  background-color: var(--color-warning-bg);
  font-size: 0.875rem;
}

.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 300px;
  gap: var(--spacing-4);
  color: var(--color-text-secondary);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--color-border-primary);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-page {
  text-align: center;
  padding: var(--spacing-16) var(--spacing-4);
}

.error-page h1 {
  margin-bottom: var(--spacing-4);
}

.error-page p {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-2);
}

.error-path {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-sm);
  color: var(--color-text-tertiary);
  margin-bottom: var(--spacing-6);
}

.unknown-content {
  text-align: center;
  padding: var(--spacing-10);
  color: var(--color-text-secondary);
}
</style>
