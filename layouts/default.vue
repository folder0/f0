<!--
  =============================================================================
  F0 - DEFAULT LAYOUT
  =============================================================================
  
  Three-column documentation layout:
  - Left: Sidebar navigation (collapsible tree)
  - Center: Main content area
  - Right: Table of Contents (sticky, shows H2/H3)
  
  Responsive behavior:
  - Desktop: All three columns visible
  - Tablet: Sidebar + Content (TOC hidden)
  - Mobile: Content only (sidebar as overlay)
  
  This layout is used for all documentation pages.
-->

<template>
  <div class="layout" :data-theme="theme" :class="{ 'sidebar-collapsed': sidebarIsCollapsed }">
    <!-- Header -->
    <LayoutHeader 
      @toggle-sidebar="sidebarOpen = !sidebarOpen"
      :sidebar-open="sidebarOpen"
    />
    
    <!-- Sidebar (left navigation) -->
    <LayoutSidebar 
      :open="sidebarOpen"
      @close="sidebarOpen = false"
    />
    
    <!-- Main content area -->
    <main class="main-content">
      <div class="content-wrapper">
        <!-- content/_partials/announcement.md -->
        <aside v-if="partials?.announcement" class="f0-partial f0-announcement" role="note" v-html="partials.announcement" />
        <slot />
      </div>

      <!-- Footer (content/_partials/footer.md, then _brand.md text and links) -->
      <footer v-if="partials?.footer || brand?.footerText || (brand?.footerLinks && brand.footerLinks.length > 0)" class="site-footer">
        <div v-if="partials?.footer" class="f0-partial f0-footer-partial" v-html="partials.footer" />
        <div class="footer-content">
          <span v-if="brand.footerText" class="footer-text">{{ brand.footerText }}</span>
          <nav v-if="brand.footerLinks && brand.footerLinks.length > 0" class="footer-links" aria-label="Footer">
            <template v-for="link in brand.footerLinks" :key="link.url">
              <a
                v-if="link.url.startsWith('http')"
                :href="link.url"
                target="_blank"
                rel="noopener noreferrer"
              >{{ link.label }}</a>
              <NuxtLink v-else :to="link.url">{{ link.label }}</NuxtLink>
            </template>
          </nav>
        </div>
      </footer>
    </main>
    
    <!-- Table of Contents (right sidebar) — client-only to avoid hydration mismatch -->
    <ClientOnly>
      <LayoutTableOfContents 
        v-if="showToc"
        :items="tocItems"
      />
    </ClientOnly>
    
    <!-- Mobile sidebar overlay -->
    <div 
      v-if="sidebarOpen"
      class="sidebar-overlay"
      @click="sidebarOpen = false"
    />
    
    <!-- Search Modal (Command Palette) -->
    <LayoutSearchModal />
  </div>
</template>

<script setup lang="ts">
// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

const sidebarOpen = ref(false)

// ---------------------------------------------------------------------------
// BRAND CONFIG
// ---------------------------------------------------------------------------

const { data: brand } = await useFetch('/api/brand', { key: 'brand' })

// Site-wide Markdown partials (content/_partials/announcement.md, footer.md)
const { data: partials } = await useFetch<{ announcement: string, footer: string }>('/api/partials', { key: 'partials' })

// Navigation is part of the server-rendered page (crawlers and readers
// without JavaScript see the header and sidebar links)
await useNavigation().ensureNavigation()

// Inject accent color, favicon, and custom CSS into head
useHead(computed(() => {
  const head: Record<string, unknown> = { link: [] as Record<string, string>[], style: [] as Record<string, string>[] }
  
  if (brand.value?.favicon) {
    (head.link as Record<string, string>[]).push({
      rel: 'icon',
      type: 'image/png',
      href: brand.value.favicon,
    })
  }
  
  if (brand.value?.customCss) {
    // Loads after the theme stylesheet, so the site's own CSS wins ties
    (head.link as Record<string, string>[]).push({
      rel: 'stylesheet',
      href: brand.value.customCss,
      tagPriority: 'low',
    })
  }
  
  if (brand.value?.accentCss) {
    // Derived on the server: accent, tint and hover shades for light and dark
    // mode, readable on each background (see server/utils/accent.ts)
    (head.style as Record<string, string>[]).push({
      innerHTML: brand.value.accentCss,
    })
  }
  
  return head
}))

// ---------------------------------------------------------------------------
// THEME
// ---------------------------------------------------------------------------

const { theme } = useTheme()

// ---------------------------------------------------------------------------
// TABLE OF CONTENTS
// ---------------------------------------------------------------------------

const { tocItems, showToc, clearToc } = useToc()

// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------

// Search shortcuts auto-register via composable when first used
useSearch()

// ---------------------------------------------------------------------------
// SIDEBAR COLLAPSE (blog reading mode)
// ---------------------------------------------------------------------------

const { isCollapsed: sidebarIsCollapsed } = useSidebarCollapse()

// ---------------------------------------------------------------------------
// ROUTE CHANGE HANDLING
// ---------------------------------------------------------------------------

const route = useRoute()

// Close sidebar on route change (mobile)
watch(() => route.path, () => {
  sidebarOpen.value = false
})

// ---------------------------------------------------------------------------
// KEYBOARD SHORTCUTS
// ---------------------------------------------------------------------------

onMounted(() => {
  const handleKeydown = (e: KeyboardEvent) => {
    // Escape closes sidebar
    if (e.key === 'Escape' && sidebarOpen.value) {
      sidebarOpen.value = false
    }
  }
  
  window.addEventListener('keydown', handleKeydown)
  
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
})
</script>

<style scoped>
.f0-announcement {
  margin-bottom: var(--spacing-6, 1.5rem);
  padding: var(--spacing-3, 0.75rem) var(--spacing-4, 1rem);
  border-radius: var(--radius-md);
  background: var(--color-accent-light);
  font-size: var(--font-size-sm);
}

.f0-announcement :deep(> *),
.f0-footer-partial :deep(> :last-child) {
  margin-bottom: 0;
}

.f0-announcement :deep(> * + *) {
  margin-top: var(--spacing-2, 0.5rem);
}

.f0-footer-partial {
  max-width: var(--content-max-width, 800px);
  margin: 0 auto var(--spacing-4, 1rem);
  font-size: var(--font-size-sm);
}

/* Sidebar overlay for mobile */
.sidebar-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 98;
  display: none;
}

@media (max-width: 768px) {
  .sidebar-overlay {
    display: block;
  }
}

/* Footer */
.site-footer {
  border-top: 1px solid var(--color-border-primary);
  padding: var(--spacing-6) var(--spacing-8);
  margin-top: auto;
}

.footer-content {
  max-width: var(--content-max-width);
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--spacing-4);
  flex-wrap: wrap;
}

.footer-text {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.footer-links {
  display: flex;
  gap: var(--spacing-4);
}

.footer-links a {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.footer-links a:hover {
  color: var(--color-accent);
  text-decoration: none;
}

@media (max-width: 768px) {
  .site-footer {
    padding: var(--spacing-4);
  }
  
  .footer-content {
    flex-direction: column;
    text-align: center;
  }
}
</style>
