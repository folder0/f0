<!--
=============================================================================
F0 - HEADER COMPONENT
=============================================================================

The main site header with:
- Logo/site name
- Top-level navigation
- Theme toggle
- Mobile menu button (future)

USAGE:
<Header />
-->

<template>
  <header class="header">
    <!-- Logo -->
    <NuxtLink to="/" class="header-logo">
      {{ siteName }}
    </NuxtLink>
    
    <!-- Top Navigation -->
    <nav class="header-nav">
      <NuxtLink
        v-for="item in topNav"
        :key="item.path"
        :to="item.isExternal ? undefined : item.path"
        :href="item.isExternal ? item.path : undefined"
        :target="item.isExternal ? '_blank' : undefined"
        :class="{ active: !item.isExternal && isActive(item.path) }"
      >
        {{ item.title }}
        <span v-if="item.isExternal" class="external-icon">↗</span>
      </NuxtLink>
    </nav>
    
    <!-- Actions -->
    <div class="header-actions">
      <!-- Theme Toggle -->
      <LayoutThemeToggle />
      
      <!-- Auth (if private mode) -->
      <button
        v-if="isAuthenticated"
        class="btn-ghost"
        @click="handleLogout"
      >
        Logout
      </button>
    </div>
    
    <!-- Mobile Menu Toggle (shown on small screens) -->
    <button
      class="mobile-menu-toggle"
      aria-label="Toggle menu"
      @click="$emit('toggle-sidebar')"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    </button>
  </header>
</template>

<script setup lang="ts">
const config = useRuntimeConfig()
const siteName = config.public.siteName || 'f0'

const { topNav, isActive } = useNavigation()
const { isAuthenticated, logout } = useAuth()

// Emit event for mobile menu toggle
defineEmits(['toggle-sidebar'])

function handleLogout() {
  logout()
}
</script>

<style scoped>
.header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-height);
  background-color: var(--color-bg-primary);
  border-bottom: 1px solid var(--color-border-primary);
  z-index: 100;
  display: flex;
  align-items: center;
  padding: 0 var(--spacing-6);
  gap: var(--spacing-4);
}

.header-logo {
  font-weight: 600;
  font-size: var(--font-size-lg);
  color: var(--color-text-primary);
  text-decoration: none;
  flex-shrink: 0;
}

.header-logo:hover {
  text-decoration: none;
}

.header-nav {
  display: flex;
  align-items: center;
  gap: var(--spacing-6);
  margin-left: var(--spacing-8);
}

.header-nav a {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  text-decoration: none;
  padding: var(--spacing-2) 0;
  transition: color var(--transition-fast);
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
}

.header-nav a:hover,
.header-nav a.active {
  color: var(--color-text-primary);
  text-decoration: none;
}

.header-nav a.active {
  color: var(--color-accent);
}

.external-icon {
  font-size: 0.75em;
  opacity: 0.7;
}

.header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--spacing-4);
}

.mobile-menu-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: none;
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text-secondary);
}

.mobile-menu-toggle:hover {
  background-color: var(--color-bg-hover);
  color: var(--color-text-primary);
}

@media (max-width: 768px) {
  .header-nav {
    display: none;
  }
  
  .mobile-menu-toggle {
    display: flex;
  }
}
</style>
