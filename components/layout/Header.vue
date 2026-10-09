<!--
=============================================================================
F0 - HEADER COMPONENT
=============================================================================

The main site header with:
- Logo/site name
- Top-level navigation
- Search button
- Theme toggle
- Mobile menu button

USAGE:
<Header />
-->

<template>
  <header class="header">
    <!-- Logo / Brand -->
    <NuxtLink to="/" class="header-logo">
      <template v-if="brand?.headerStyle !== 'text_only' && brand?.logo">
        <!-- Both logos are in the HTML and CSS picks one from data-theme, which
             is set before first paint: no wrong logo while scripts load -->
        <img
          :src="brand.logo"
          :alt="siteName"
          class="header-logo-img"
          :class="{ 'header-logo-light': hasDarkLogo }"
        />
        <img
          v-if="hasDarkLogo"
          :src="brand.logoDark"
          :alt="siteName"
          class="header-logo-img header-logo-dark"
        />
      </template>
      <span v-if="brand?.headerStyle !== 'logo_only' || !brand?.logo">
        {{ siteName }}
      </span>
    </NuxtLink>
    
    <!-- Top Navigation -->
    <nav class="header-nav" aria-label="Main">
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
      <!-- Search Button -->
      <button
        class="search-button"
        aria-label="Search documentation"
        @click="openSearch"
      >
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <span class="search-text">Search</span>
        <kbd class="search-shortcut">⌘K</kbd>
      </button>
      
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
const { openSearch } = useSearch()

// Fetch brand configuration
const { data: brand } = await useFetch('/api/brand', { key: 'brand' })

// A separate dark-mode logo (logo_dark defaults to logo)
const hasDarkLogo = computed(() => !!brand.value?.logoDark && brand.value.logoDark !== brand.value.logo)

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
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.header-logo:hover {
  text-decoration: none;
}

.header-logo-img {
  height: 28px;
  width: auto;
  object-fit: contain;
}

.header-logo-dark {
  display: none;
}

:root[data-theme="dark"] .header-logo-dark {
  display: block;
}

:root[data-theme="dark"] .header-logo-light {
  display: none;
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
  gap: var(--spacing-3);
}

/* Search Button */
.search-button {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-2) var(--spacing-3);
  background-color: var(--color-bg-secondary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  transition: all var(--transition-fast);
  min-width: 200px;
}

.search-button:hover {
  background-color: var(--color-bg-hover);
  border-color: var(--color-border-secondary);
  color: var(--color-text-secondary);
}

.search-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.search-text {
  flex: 1;
  text-align: left;
}

.search-shortcut {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  background-color: var(--color-bg-primary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-sm);
  font-family: var(--font-family-mono);
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
  
  .search-button {
    min-width: auto;
    padding: var(--spacing-2);
  }
  
  .search-text,
  .search-shortcut {
    display: none;
  }
  
  .mobile-menu-toggle {
    display: flex;
  }
}
</style>
