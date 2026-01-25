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
    
    <!-- Error state (404) -->
    <div v-else-if="error" class="error-page">
      <h1>Page Not Found</h1>
      <p>The requested documentation page could not be found.</p>
      <p class="error-path">{{ route.path }}</p>
      <NuxtLink to="/" class="btn btn-primary">Go to Home</NuxtLink>
    </div>
    
    <!-- Content -->
    <article v-else class="content">
      <!-- Markdown content -->
      <ContentMarkdownRenderer 
        v-if="content?.type === 'markdown'"
        :html="content.html" 
        :toc="content.toc"
        :title="content.title"
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
// SEO
// ---------------------------------------------------------------------------

useSeo({
  title: content.value?.title,
  description: content.value?.description,
})

// Update page title when content changes
watch(content, (newContent) => {
  if (newContent?.title) {
    useSeo({
      title: newContent.title,
      description: newContent.description,
    })
  }
})

// ---------------------------------------------------------------------------
// TOC INJECTION
// ---------------------------------------------------------------------------

// Get TOC setter from composable
const { setTocItems } = useToc()

// Update TOC when content loads
watch(content, (newContent) => {
  if (newContent?.toc) {
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
