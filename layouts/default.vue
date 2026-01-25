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
  <div class="layout" :data-theme="theme">
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
    </main>
    
    <!-- Table of Contents (right sidebar) -->
    <LayoutTableOfContents 
      v-if="showToc"
      :items="tocItems"
    />
    
    <!-- Mobile sidebar overlay -->
    <div 
      v-if="sidebarOpen"
      class="sidebar-overlay"
      @click="sidebarOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

const sidebarOpen = ref(false)

// ---------------------------------------------------------------------------
// THEME
// ---------------------------------------------------------------------------

const { theme } = useTheme()

// ---------------------------------------------------------------------------
// TABLE OF CONTENTS
// ---------------------------------------------------------------------------

const { tocItems, showToc, clearToc } = useToc()

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
    
    // Cmd/Ctrl + K could open search (future feature)
    // if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    //   e.preventDefault()
    //   openSearch()
    // }
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
</style>
