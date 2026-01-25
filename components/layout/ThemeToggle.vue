<!--
=============================================================================
F0 - THEME TOGGLE COMPONENT
=============================================================================

A button to toggle between light and dark themes.
Shows sun icon for light mode, moon icon for dark mode.

USAGE:
<ThemeToggle />
-->

<template>
  <button
    class="theme-toggle"
    :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    @click="toggle"
  >
    <!-- Sun icon (shown in dark mode, clicking switches to light) -->
    <svg
      v-if="mounted && isDark"
      class="theme-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
    
    <!-- Moon icon (shown in light mode or before hydration) -->
    <svg
      v-else
      class="theme-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  </button>
</template>

<script setup lang="ts">
const { isDark, toggle } = useTheme()

// Track if component is mounted (for SSR hydration)
const mounted = ref(false)
onMounted(() => {
  mounted.value = true
})
</script>

<style scoped>
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background-color: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text-primary);
  transition: all var(--transition-fast);
}

.theme-toggle:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-accent);
  border-color: var(--color-accent);
}

.theme-icon {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  transition: transform var(--transition-normal);
}

.theme-toggle:hover .theme-icon {
  transform: rotate(15deg);
}
</style>
