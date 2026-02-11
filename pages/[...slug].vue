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
    <BlogBlogIndex v-else-if="isBlogIndex" :path="blogIndexPath" />
    
    <!-- Content -->
    <article v-else class="content">
      <!-- Blog post layout -->
      <BlogBlogPostLayout
        v-if="content?.layout === 'blog' && content?.type === 'markdown'"
        :content="content"
      />
      
      <!-- Markdown content (docs layout) -->
      <ContentMarkdownRenderer 
        v-else-if="content?.type === 'markdown'"
        :html="content.html" 
        :toc="content.toc"
        :title="content.title"
        :markdown="content.markdown"
        :path="content.path"
      />
      
      <!-- API documentation (OpenAPI/Postman) -->
      <ContentApiDocViewer
        v-else-if="content?.type === 'openapi' || content?.type === 'postman'"
        :spec="content.spec"
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
  blog?: {
    date: string
    author: string
    tags: string[]
    coverImage?: string
    excerpt: string
    pinned: boolean
    readingTime: number
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
  }
)

// ---------------------------------------------------------------------------
// BLOG INDEX DETECTION
// ---------------------------------------------------------------------------
// If content 404s, check if this path is a blog directory root
// If so, render BlogIndex instead of the error page

const isBlogIndex = ref(false)
const blogIndexPath = computed(() => '/' + slug.value)

// Check if this is a blog directory when content returns 404
watch([error, pending], async () => {
  if (error.value && !pending.value) {
    try {
      const blogCheck = await $fetch<{ config: { layout: string } }>('/api/blog', {
        query: { path: slug.value },
      })
      if (blogCheck?.config?.layout === 'blog') {
        isBlogIndex.value = true
      }
    } catch {
      // Not a blog directory, show normal error
    }
  } else {
    isBlogIndex.value = false
  }
}, { immediate: true })

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

useSeo({
  title: content.value?.title,
  description: content.value?.blog?.excerpt || content.value?.description,
  image: content.value?.blog?.coverImage,
  type: content.value?.layout === 'blog' ? 'article' : 'website',
  publishedTime: content.value?.blog?.date,
  author: content.value?.blog?.author,
  tags: content.value?.blog?.tags,
})

// Update page title when content changes
watch(content, (newContent) => {
  if (newContent?.title) {
    useSeo({
      title: newContent.title,
      description: newContent.blog?.excerpt || newContent.description,
      image: newContent.blog?.coverImage,
      type: newContent.layout === 'blog' ? 'article' : 'website',
      publishedTime: newContent.blog?.date,
      author: newContent.blog?.author,
      tags: newContent.blog?.tags,
    })
  }
})

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
