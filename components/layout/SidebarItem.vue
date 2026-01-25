<!--
=============================================================================
F0 - SIDEBAR ITEM COMPONENT
=============================================================================

A single item in the sidebar navigation.
Can be a file (link) or folder (collapsible group).
Recursively renders children.

USAGE:
<SidebarItem :item="item" :depth="0" />

PROPS:
- item: SidebarItem - The navigation item to render
- depth: number - Nesting depth for indentation
-->

<template>
  <!-- Folder (collapsible group) -->
  <div
    v-if="item.type === 'folder'"
    class="sidebar-group"
    :class="{ open: isOpen }"
  >
    <button
      class="sidebar-group-toggle"
      :style="{ paddingLeft: `${paddingLeft}px` }"
      @click="toggleOpen"
    >
      <span class="sidebar-group-title">{{ item.title }}</span>
      <svg
        class="sidebar-group-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
    
    <div v-if="isOpen && item.children" class="sidebar-group-children">
      <LayoutSidebarItem
        v-for="child in item.children"
        :key="child.path"
        :item="child"
        :depth="depth + 1"
      />
    </div>
  </div>
  
  <!-- File (link) -->
  <NuxtLink
    v-else
    :to="normalizedPath"
    class="sidebar-item"
    :class="{ active: isActive(item.path) }"
    :style="{ paddingLeft: `${paddingLeft}px` }"
  >
    {{ item.title }}
  </NuxtLink>
</template>

<script setup lang="ts">
import type { SidebarItem as SidebarItemType } from '~/server/utils/navigation'

// Props
const props = defineProps<{
  item: SidebarItemType
  depth: number
}>()

// Navigation
const { isActive, isExpanded } = useNavigation()

// Ensure path always starts with /
const normalizedPath = computed(() => {
  const rawPath = props.item?.path
  
  // Handle missing/invalid paths
  if (!rawPath || typeof rawPath !== 'string') {
    return '/'
  }
  
  // Ensure leading slash (defensive, should already have it from server)
  return rawPath.startsWith('/') ? rawPath : `/${rawPath}`
})

// Calculate left padding based on depth
const paddingLeft = computed(() => {
  const basePadding = 24 // Base padding (--spacing-6)
  const depthPadding = 16 // Additional padding per depth level
  return basePadding + (props.depth * depthPadding)
})

// Open state for folders
const manuallyToggled = ref(false)
const manualOpen = ref(false)

const isOpen = computed(() => {
  if (manuallyToggled.value) {
    return manualOpen.value
  }
  // Auto-expand if has active child
  return isExpanded(props.item)
})

function toggleOpen() {
  manuallyToggled.value = true
  manualOpen.value = !manualOpen.value
}

// Reset manual toggle when route changes
const route = useRoute()
watch(() => route.path, () => {
  manuallyToggled.value = false
})
</script>

<style scoped>
.sidebar-group {
  margin-bottom: var(--spacing-1);
}

.sidebar-group-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--spacing-2) var(--spacing-6);
  padding-right: var(--spacing-4);
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all var(--transition-fast);
  border-left: 2px solid transparent;
}

.sidebar-group-toggle:hover {
  color: var(--color-text-primary);
  background-color: var(--color-bg-hover);
}

.sidebar-group-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-group-icon {
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}

.sidebar-group.open .sidebar-group-icon {
  transform: rotate(90deg);
}

.sidebar-group-children {
  margin-top: var(--spacing-1);
}

.sidebar-item {
  display: block;
  padding: var(--spacing-2) var(--spacing-6);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  text-decoration: none;
  transition: all var(--transition-fast);
  border-left: 2px solid transparent;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-item:hover {
  color: var(--color-text-primary);
  background-color: var(--color-bg-hover);
  text-decoration: none;
}

.sidebar-item.active {
  color: var(--color-accent);
  background-color: var(--color-accent-light);
  border-left-color: var(--color-accent);
  font-weight: 500;
}
</style>
