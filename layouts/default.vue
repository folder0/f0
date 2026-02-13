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
        <slot />
      </div>

      <!-- Footer (from _brand.md) — inside main-content so it sits below content -->
      <footer v-if="brand?.footerText || (brand?.footerLinks && brand.footerLinks.length > 0)" class="site-footer">
        <div class="footer-content">
          <span v-if="brand.footerText" class="footer-text">{{ brand.footerText }}</span>
          <nav v-if="brand.footerLinks && brand.footerLinks.length > 0" class="footer-links">
            <template v-for="link in brand.footerLinks" :key="link.url">
              <a
                v-if="isExternalLink(link.url)"
                :href="link.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                {{ link.label }}
              </a>
              <NuxtLink v-else :to="link.url">
                {{ link.label }}
              </NuxtLink>
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
    (head.link as Record<string, string>[]).push({
      rel: 'stylesheet',
      href: brand.value.customCss,
    })
  }
  
  if (brand.value?.accentColor) {
    (head.style as Record<string, string>[]).push({
      innerHTML: `:root { --color-accent: ${brand.value.accentColor}; --color-accent-light: ${brand.value.accentColor}20; }`,
    })
  }
  
  return head
}))

// Helper for external links in footer
function isExternalLink(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://')
}

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

/* Footer — now inside main-content, sits at bottom */
.site-footer {
  border-top: 1px solid var(--color-border-primary);
  padding: var(--spacing-6) 0;
  margin-top: var(--spacing-12);
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
    padding: var(--spacing-4) 0;
  }
  
  .footer-content {
    flex-direction: column;
    text-align: center;
  }
}
</style>
