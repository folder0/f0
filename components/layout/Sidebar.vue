<!--
=============================================================================
F0 - SIDEBAR COMPONENT
=============================================================================

The left sidebar navigation showing the documentation tree.
Supports recursive folders with collapse/expand.

USAGE:
<Sidebar :open="isMobileMenuOpen" @close="closeMobileMenu" />

PROPS:
- open: Boolean - Whether sidebar is visible on mobile
-->

<template>
  <aside class="sidebar" :class="{ open }">
    <!-- Close button for mobile -->
    <button
      class="sidebar-close"
      aria-label="Close menu"
      @click="$emit('close')"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
    
    <!-- Loading state -->
    <div v-if="loading" class="sidebar-loading">
      Loading...
    </div>
    
    <!-- Navigation tree -->
    <nav v-else class="sidebar-nav">
      <div
        v-for="item in currentSidebar"
        :key="item.path"
        class="sidebar-section"
      >
        <LayoutSidebarItem :item="item" :depth="0" />
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
// Props
defineProps<{
  open?: boolean
}>()

// Emits
defineEmits(['close'])

// Navigation
const { currentSidebar, loading, fetchNavigation } = useNavigation()

// Fetch navigation on mount
onMounted(() => {
  fetchNavigation()
})
</script>

<style scoped>
.sidebar {
  position: fixed;
  top: var(--header-height);
  left: 0;
  bottom: 0;
  width: var(--sidebar-width);
  background-color: var(--color-bg-primary);
  border-right: 1px solid var(--color-border-primary);
  overflow-y: auto;
  padding: var(--spacing-4) 0;
  transition: transform var(--transition-normal), background-color var(--transition-normal);
  z-index: 99;
}

.sidebar-close {
  display: none;
  position: absolute;
  top: var(--spacing-4);
  right: var(--spacing-4);
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text-secondary);
  align-items: center;
  justify-content: center;
}

.sidebar-close:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.sidebar-loading {
  padding: var(--spacing-4) var(--spacing-6);
  color: var(--color-text-tertiary);
  font-size: var(--font-size-sm);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.sidebar-section {
  margin-bottom: var(--spacing-2);
}

/* Mobile styles */
@media (max-width: 768px) {
  .sidebar {
    transform: translateX(-100%);
    width: 280px;
    padding-top: var(--spacing-12);
  }
  
  .sidebar.open {
    transform: translateX(0);
    box-shadow: var(--shadow-lg);
  }
  
  .sidebar-close {
    display: flex;
  }
}
</style>
