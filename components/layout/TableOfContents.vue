<!--
=============================================================================
F0 - TABLE OF CONTENTS COMPONENT
=============================================================================

The right sidebar showing page headings (H2/H3) for quick navigation.
Highlights current section based on scroll position.

USAGE:
<TableOfContents :items="tocItems" />

PROPS:
- items: TocItem[] - Array of heading items to display
-->

<template>
  <aside v-if="items.length > 0" class="toc">
    <h4 class="toc-title">On this page</h4>
    
    <ul class="toc-list">
      <li
        v-for="item in items"
        :key="item.id"
        class="toc-item"
      >
        <a
          :href="`#${item.id}`"
          class="toc-link"
          :class="{ active: activeId === item.id }"
          @click.prevent="scrollTo(item.id)"
        >
          {{ item.text }}
        </a>
        
        <!-- Nested items (H3 under H2) -->
        <ul v-if="item.children && item.children.length > 0" class="toc-list">
          <li
            v-for="child in item.children"
            :key="child.id"
            class="toc-item toc-item-nested"
          >
            <a
              :href="`#${child.id}`"
              class="toc-link"
              :class="{ active: activeId === child.id }"
              @click.prevent="scrollTo(child.id)"
            >
              {{ child.text }}
            </a>
          </li>
        </ul>
      </li>
    </ul>
  </aside>
</template>

<script setup lang="ts">
interface TocItem {
  id: string
  text: string
  level: number
  children?: TocItem[]
}

// Props
const props = defineProps<{
  items: TocItem[]
}>()

// Active section tracking
const activeId = ref<string>('')

// Scroll to heading
function scrollTo(id: string) {
  const element = document.getElementById(id)
  if (element) {
    element.scrollIntoView({ behavior: 'smooth' })
    // Update URL hash without jumping
    history.pushState(null, '', `#${id}`)
    activeId.value = id
  }
}

// Track scroll position to highlight current section
function updateActiveSection() {
  if (!import.meta.client) return
  
  const headings = props.items.flatMap(item => [
    item,
    ...(item.children || [])
  ])
  
  const scrollTop = window.scrollY
  const offset = 100 // Account for fixed header
  
  // Find the heading that's currently in view
  let currentId = ''
  
  for (const heading of headings) {
    const element = document.getElementById(heading.id)
    if (element) {
      const top = element.getBoundingClientRect().top + scrollTop
      if (top <= scrollTop + offset) {
        currentId = heading.id
      }
    }
  }
  
  activeId.value = currentId
}

// Set up scroll listener
onMounted(() => {
  window.addEventListener('scroll', updateActiveSection, { passive: true })
  updateActiveSection()
  
  // Check for hash in URL
  if (window.location.hash) {
    activeId.value = window.location.hash.slice(1)
  }
})

onUnmounted(() => {
  window.removeEventListener('scroll', updateActiveSection)
})

// Update when items change
watch(() => props.items, () => {
  updateActiveSection()
}, { deep: true })
</script>

<style scoped>
.toc {
  position: fixed;
  top: var(--header-height);
  right: 0;
  bottom: 0;
  width: var(--toc-width);
  padding: var(--spacing-6) var(--spacing-4);
  overflow-y: auto;
  border-left: 1px solid var(--color-border-primary);
}

.toc-title {
  font-size: var(--font-size-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-tertiary);
  margin: 0 0 var(--spacing-4) 0;
  padding: 0;
}

.toc-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-item {
  margin-bottom: var(--spacing-1);
}

.toc-item-nested {
  padding-left: var(--spacing-4);
}

.toc-link {
  display: block;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  text-decoration: none;
  padding: var(--spacing-1) 0;
  transition: color var(--transition-fast);
  line-height: 1.4;
}

.toc-link:hover {
  color: var(--color-text-primary);
  text-decoration: none;
}

.toc-link.active {
  color: var(--color-accent);
  font-weight: 500;
}

/* Hide on medium screens */
@media (max-width: 1200px) {
  .toc {
    display: none;
  }
}
</style>
