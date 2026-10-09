<!--
=============================================================================
F0 - MARKDOWN RENDERER COMPONENT
=============================================================================

Renders HTML content from parsed markdown with:
- Automatic code copy buttons
- Smooth scroll to headings
- Image lazy loading
- TOC injection into layout
- Copy page button

USAGE:
<ContentMarkdownRenderer :html="parsedHtml" :toc="tocItems" :title="pageTitle" :markdown="rawMarkdown" />

PROPS:
- html: string - Pre-rendered HTML from the markdown parser
- toc: TocItem[] - Table of contents items
- title: string - Page title (optional)
- markdown: string - Raw markdown source (optional, for copy feature)
-->

<template>
  <div class="markdown-page">
    <!-- Page header with title and copy button -->
    <div class="page-header" v-if="title || !htmlHasH1">
      <h1 v-if="title && !htmlHasH1" class="page-title">{{ title }}</h1>
      <div class="page-actions">
        <ContentCopyPageButton :content="html" :markdown="markdown" :title="title" :path="path" />
      </div>
    </div>
    
    <!-- Copy button for pages with H1 in content -->
    <div class="page-actions-float" v-else>
      <ContentCopyPageButton :content="html" :markdown="markdown" :title="title" :path="path" />
    </div>
    
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
  markdown?: string
  path?: string
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

// Mermaid is browser-only. The import.meta.client ternary is constant-folded at
// build time, so the server bundle never references 'mermaid' and Nitro does not
// trace mermaid and its dependency graph into .output/server.
const loadMermaid = () => import.meta.client
  ? import('mermaid')
  : Promise.reject(new Error('mermaid is client-only'))

// Initialize mermaid diagrams
async function setupMermaid() {
  if (!contentRef.value) return

  const mermaidBlocks = contentRef.value.querySelectorAll('.mermaid[data-mermaid="true"]')
  if (mermaidBlocks.length === 0) return

  // Dynamically import mermaid only when needed
  try {
    const mermaid = await loadMermaid()
    
    // Initialize mermaid with beautiful-mermaid inspired config
    mermaid.default.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        // Beautiful-mermaid inspired colors
        primaryColor: '#4f46e5',
        primaryTextColor: '#ffffff',
        primaryBorderColor: '#4338ca',
        lineColor: '#6366f1',
        secondaryColor: '#f1f5f9',
        tertiaryColor: '#e2e8f0',
        // Text colors
        textColor: '#1e293b',
        // Note colors
        noteBkgColor: '#fef3c7',
        noteTextColor: '#92400e',
        noteBorderColor: '#fcd34d',
        // Flowchart
        nodeBorder: '#4338ca',
        clusterBkg: '#f8fafc',
        clusterBorder: '#cbd5e1',
        // Sequence diagram
        actorBkg: '#4f46e5',
        actorTextColor: '#ffffff',
        actorBorder: '#4338ca',
        actorLineColor: '#94a3b8',
        signalColor: '#1e293b',
        signalTextColor: '#1e293b',
        // Gantt
        sectionBkgColor: '#f1f5f9',
        altSectionBkgColor: '#e2e8f0',
        taskBkgColor: '#4f46e5',
        taskTextColor: '#ffffff',
        taskBorderColor: '#4338ca',
        doneTaskBkgColor: '#10b981',
        // Git graph
        git0: '#4f46e5',
        git1: '#10b981',
        git2: '#f59e0b',
        git3: '#ef4444',
        git4: '#8b5cf6',
        git5: '#06b6d4',
        git6: '#ec4899',
        git7: '#84cc16',
        gitBranchLabel0: '#ffffff',
        commitLabelColor: '#1e293b',
      },
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 14,
      flowchart: {
        htmlLabels: true,
        curve: 'basis',
        padding: 15,
      },
      sequence: {
        diagramMarginX: 50,
        diagramMarginY: 10,
        actorMargin: 50,
        width: 150,
        height: 65,
        boxMargin: 10,
        boxTextMargin: 5,
        noteMargin: 10,
        messageMargin: 35,
      },
    })
    
    // Render each mermaid block
    let counter = 0
    for (const block of mermaidBlocks) {
      const code = block.textContent || ''
      const id = `mermaid-${Date.now()}-${counter++}`
      
      try {
        const { svg } = await mermaid.default.render(id, code)
        block.innerHTML = svg
        block.removeAttribute('data-mermaid')
        block.classList.add('mermaid-rendered')
      } catch (err) {
        console.error('Mermaid render error:', err)
        // Show error state
        // Build the error box with text nodes: the diagram source is author
        // content and must never be parsed as HTML.
        const box = document.createElement('div')
        box.className = 'mermaid-error'
        const heading = document.createElement('strong')
        heading.textContent = 'Diagram Error'
        const source = document.createElement('pre')
        source.textContent = code
        const message = document.createElement('small')
        message.textContent = err instanceof Error ? err.message : 'Failed to render diagram'
        box.append(heading, source, message)
        block.replaceChildren(box)
        block.classList.add('mermaid-error-container')
      }
    }
  } catch (err) {
    console.error('Failed to load mermaid:', err)
  }
}

// Run setup after mount and when HTML changes
onMounted(() => {
  setupCopyButtons()
  setupExternalLinks()
  setupLazyImages()
  setupMermaid()
})

watch(() => props.html, () => {
  // Wait for DOM update
  nextTick(() => {
    setupCopyButtons()
    setupExternalLinks()
    setupLazyImages()
    setupMermaid()
  })
})
</script>

<style scoped>
.markdown-page {
  position: relative;
}

/* Page header with title and actions */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-4);
  margin-bottom: var(--spacing-6);
}

.page-header .page-title {
  margin: 0;
  flex: 1;
}

.page-actions {
  flex-shrink: 0;
}

/* Floating copy button for pages with H1 in content */
.page-actions-float {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
}

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

/* Adjust first heading when floating copy button is present */
.page-actions-float + .markdown-content :deep(h1:first-child) {
  padding-right: 140px; /* Make room for copy button */
}

@media (max-width: 640px) {
  .page-header {
    flex-direction: column;
    gap: var(--spacing-3);
  }
  
  .page-actions-float {
    position: static;
    margin-bottom: var(--spacing-4);
  }
  
  .page-actions-float + .markdown-content :deep(h1:first-child) {
    padding-right: 0;
  }
}
</style>
