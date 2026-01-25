/**
 * =============================================================================
 * F0 - NAVIGATION COMPOSABLE
 * =============================================================================
 * 
 * Client-side navigation state and utilities.
 * 
 * USAGE:
 * ```vue
 * const { topNav, sidebar, currentSection, isActive } = useNavigation()
 * ```
 * 
 * FEATURES:
 * - Fetches and caches navigation structure
 * - Tracks current section for sidebar display
 * - Provides active state checking for links
 */

import type { TopNavItem, SidebarItem } from '~/server/utils/navigation'

interface NavigationState {
  topNav: TopNavItem[]
  sidebar: Record<string, SidebarItem[]>
  loading: boolean
  error: string | null
}

/**
 * Navigation composable
 */
export function useNavigation() {
  const route = useRoute()
  
  // State
  const state = useState<NavigationState>('navigation', () => ({
    topNav: [],
    sidebar: {},
    loading: true,
    error: null,
  }))
  
  /**
   * Current top-level section based on route
   * e.g., /guides/auth/setup → /guides
   */
  const currentSection = computed(() => {
    const path = route.path
    
    // Find matching top nav item
    for (const item of state.value.topNav) {
      if (item.path === '/') continue // Skip home
      if (path.startsWith(item.path)) {
        return item.path
      }
    }
    
    return '/'
  })
  
  /**
   * Sidebar items for current section
   */
  const currentSidebar = computed(() => {
    const section = currentSection.value
    return state.value.sidebar[section] || state.value.sidebar['/'] || []
  })
  
  /**
   * Check if a path is active (exact or parent match)
   */
  function isActive(path: string): boolean {
    const currentPath = route.path
    
    // Exact match
    if (currentPath === path) return true
    
    // Parent match (for folders)
    if (path !== '/' && currentPath.startsWith(path + '/')) return true
    
    return false
  }
  
  /**
   * Check if a section is currently expanded (has active child)
   */
  function isExpanded(item: SidebarItem): boolean {
    if (item.type !== 'folder' || !item.children) return false
    
    const currentPath = route.path
    
    // Check if any child is active
    return item.children.some(child => {
      if (isActive(child.path)) return true
      if (child.type === 'folder' && child.children) {
        return isExpanded(child)
      }
      return false
    })
  }
  
  /**
   * Fetch navigation data from API
   */
  async function fetchNavigation() {
    state.value.loading = true
    state.value.error = null
    
    try {
      const data = await $fetch<{
        topNav: TopNavItem[]
        sidebar: Record<string, SidebarItem[]>
      }>('/api/navigation')
      
      state.value.topNav = data.topNav
      state.value.sidebar = data.sidebar
    } catch (error: any) {
      console.error('Failed to fetch navigation:', error)
      state.value.error = error.message || 'Failed to load navigation'
    } finally {
      state.value.loading = false
    }
  }
  
  /**
   * Refresh navigation (after content update)
   */
  async function refreshNavigation() {
    await fetchNavigation()
  }
  
  /**
   * Find item by path in sidebar tree
   */
  function findItemByPath(
    items: SidebarItem[],
    path: string
  ): SidebarItem | null {
    for (const item of items) {
      if (item.path === path) return item
      
      if (item.children) {
        const found = findItemByPath(item.children, path)
        if (found) return found
      }
    }
    return null
  }
  
  /**
   * Get breadcrumb path for current route
   */
  const breadcrumbs = computed(() => {
    const path = route.path
    const parts = path.split('/').filter(Boolean)
    const crumbs: Array<{ title: string; path: string }> = []
    
    let currentPath = ''
    for (const part of parts) {
      currentPath += '/' + part
      
      // Try to find in sidebar
      const item = findItemByPath(currentSidebar.value, currentPath)
      
      crumbs.push({
        title: item?.title || formatPathPart(part),
        path: currentPath,
      })
    }
    
    return crumbs
  })
  
  /**
   * Format a path part for display
   * getting-started → Getting Started
   */
  function formatPathPart(part: string): string {
    return part
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  }
  
  // Fetch on first use
  if (state.value.topNav.length === 0 && !state.value.loading) {
    fetchNavigation()
  }
  
  return {
    // State
    topNav: computed(() => state.value.topNav),
    sidebar: computed(() => state.value.sidebar),
    currentSidebar,
    currentSection,
    breadcrumbs,
    loading: computed(() => state.value.loading),
    error: computed(() => state.value.error),
    
    // Methods
    isActive,
    isExpanded,
    fetchNavigation,
    refreshNavigation,
    findItemByPath,
  }
}
