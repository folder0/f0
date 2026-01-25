<!--
=============================================================================
F0 - MARKDOWN RENDERER COMPONENT
=============================================================================

Renders HTML content from parsed markdown with:
- Automatic code copy buttons
- Smooth scroll to headings
- Image lazy loading
- TOC injection into layout

USAGE:
<ContentMarkdownRenderer :html="parsedHtml" :toc="tocItems" :title="pageTitle" />

PROPS:
- html: string - Pre-rendered HTML from the markdown parser
- toc: TocItem[] - Table of contents items
- title: string - Page title (optional)
-->

<template>
  <div class="markdown-page">
    <!-- Title if provided and not in HTML -->
    <h1 v-if="title && !htmlHasH1" class="page-title">{{ title }}</h1>
    
    <!-- Rendered content -->
    <div
      ref="contentRef"
      class="markdown-content"
      v-html="html"
    />
  </div>
</template>

<script setup lang="ts">
import type { TocItem } from '~/server/utils/markdown'

// Props
const props = defineProps<{
  html: string
  toc?: TocItem[]
  title?: string
}>()

// Check if HTML already has an H1
const htmlHasH1 = computed(() => {
  return props.html?.includes('<h1')
})

const contentRef = ref<HTMLElement | null>(null)

// Add copy functionality to code blocks
function setupCopyButtons() {
  if (!contentRef.value) return
  
  const copyButtons = contentRef.value.querySelectorAll('.copy-button')
  
  copyButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const codeBlock = button.closest('.code-block')
      const code = codeBlock?.querySelector('code')
      
      if (code) {
        try {
          await navigator.clipboard.writeText(code.textContent || '')
          
          // Show copied feedback
          const originalText = button.textContent
          button.textContent = 'Copied!'
          button.classList.add('copied')
          
          setTimeout(() => {
            button.textContent = originalText
            button.classList.remove('copied')
          }, 2000)
        } catch (err) {
          console.error('Failed to copy:', err)
        }
      }
    })
  })
}

// Setup external link handling
function setupExternalLinks() {
  if (!contentRef.value) return
  
  const links = contentRef.value.querySelectorAll('a')
  
  links.forEach((link) => {
    const href = link.getAttribute('href')
    
    // External links open in new tab
    if (href?.startsWith('http://') || href?.startsWith('https://')) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    }
  })
}

// Setup lazy loading for images
function setupLazyImages() {
  if (!contentRef.value) return
  
  const images = contentRef.value.querySelectorAll('img')
  
  images.forEach((img) => {
    img.setAttribute('loading', 'lazy')
  })
}

// Run setup after mount and when HTML changes
onMounted(() => {
  setupCopyButtons()
  setupExternalLinks()
  setupLazyImages()
})

watch(() => props.html, () => {
  // Wait for DOM update
  nextTick(() => {
    setupCopyButtons()
    setupExternalLinks()
    setupLazyImages()
  })
})
</script>

<style scoped>
.markdown-content {
  /* Typography handled by global styles */
}

/* Ensure content takes full width */
.markdown-content :deep(> *:first-child) {
  margin-top: 0;
}

.markdown-content :deep(> *:last-child) {
  margin-bottom: 0;
}

/* Heading anchor links */
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  scroll-margin-top: calc(var(--header-height) + var(--spacing-6));
}

/* Code blocks already styled globally, but ensure no overflow */
.markdown-content :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
}

/* Images */
.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
}

/* Tables responsive wrapper */
.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
</style>
