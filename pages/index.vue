<!--
  =============================================================================
  F0 - HOME PAGE
  =============================================================================
  
  The landing page for the documentation site.
  Renders content from /content/home.md if it exists,
  otherwise shows a default welcome message.
  
  When F0_MODE=blog (or root _config.md has layout: blog),
  renders the BlogIndex instead.
-->

<template>
  <div class="home-page">
    <!-- Blog Mode: Render BlogIndex -->
    <BlogIndex v-if="isBlogMode" path="/" />
    
    <!-- Docs Mode: Standard home page -->
    <template v-else>
      <!-- Loading state -->
      <div v-if="pending" class="loading">
        <p>Loading...</p>
      </div>
      
      <!-- Error state -->
      <div v-else-if="error" class="error-state">
        <h1>Welcome to {{ siteName }}</h1>
        <p>Documentation is being set up. Check back soon!</p>
      </div>
      
      <!-- Content -->
      <article v-else class="content">
        <ContentMarkdownRenderer 
          :html="content?.html || ''" 
          :toc="content?.toc || []"
          :title="content?.title"
          :markdown="content?.markdown"
          path="/"
        />
      </article>
    </template>
  </div>
</template>

<script setup lang="ts">
// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const config = useRuntimeConfig()
const siteName = config.public.siteName || 'f0'
const siteDescription = config.public.siteDescription || 'Documentation'

// ---------------------------------------------------------------------------
// BLOG MODE DETECTION
// ---------------------------------------------------------------------------
// Check if root directory is configured as blog via API

const { data: blogCheck } = await useFetch<{ config: { layout: string } }>('/api/blog', {
  query: { path: '' },
})

const isBlogMode = computed(() => blogCheck.value?.config?.layout === 'blog')

// ---------------------------------------------------------------------------
// FETCH HOME CONTENT (only in docs mode)
// ---------------------------------------------------------------------------

const { data: content, pending, error } = await useFetch('/api/content/home', {
  // Don't throw on 404 - we'll show default content
  onResponseError({ response }) {
    if (response.status !== 404) {
      console.error('Error fetching home content:', response)
    }
  }
})

// Advertise the page's Markdown source to agents and tools
useHead({ link: [{ rel: 'alternate', type: 'text/markdown', href: '/home.md' }] })

// ---------------------------------------------------------------------------
// TOC
// ---------------------------------------------------------------------------

const { setTocItems } = useToc()

// Update TOC when content loads
watch(content, (newContent) => {
  if (isBlogMode.value) {
    setTocItems([])
  } else if (newContent?.toc) {
    setTocItems(newContent.toc)
  } else {
    setTocItems([])
  }
}, { immediate: true })

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

// Single, reactive head source (useSeo appends "| siteName" to the title).
useSeo(() => ({
  title: isBlogMode.value ? 'Blog' : 'Documentation',
  description: siteDescription,
}))
</script>

<style scoped>
.home-page {
  max-width: var(--content-max-width);
}

.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
  color: var(--color-text-secondary);
}

.error-state {
  text-align: center;
  padding: var(--spacing-10) var(--spacing-4);
}

.error-state h1 {
  margin-bottom: var(--spacing-4);
}

.error-state p {
  color: var(--color-text-secondary);
}
</style>
