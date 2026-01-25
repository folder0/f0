<!--
  =============================================================================
  F0 - HOME PAGE
  =============================================================================
  
  The landing page for the documentation site.
  Renders content from /content/home.md if it exists,
  otherwise shows a default welcome message.
-->

<template>
  <div class="home-page">
    <!-- SEO -->
    <Head>
      <Title>{{ siteName }} - Documentation</Title>
      <Meta name="description" :content="siteDescription" />
    </Head>
    
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
      />
    </article>
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
// FETCH HOME CONTENT
// ---------------------------------------------------------------------------

const { data: content, pending, error } = await useFetch('/api/content/home', {
  // Don't throw on 404 - we'll show default content
  onResponseError({ response }) {
    if (response.status !== 404) {
      console.error('Error fetching home content:', response)
    }
  }
})

// ---------------------------------------------------------------------------
// TOC
// ---------------------------------------------------------------------------

const { setTocItems } = useToc()

// Update TOC when content loads
watch(content, (newContent) => {
  if (newContent?.toc) {
    setTocItems(newContent.toc)
  } else {
    setTocItems([])
  }
}, { immediate: true })

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

useSeo({
  title: `${siteName} - Documentation`,
  description: siteDescription,
})
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
