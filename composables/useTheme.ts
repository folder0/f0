/**
 * =============================================================================
 * F0 - THEME COMPOSABLE
 * =============================================================================
 * 
 * Handles dark/light mode theme switching with system preference detection
 * and localStorage persistence.
 * 
 * USAGE:
 * ```vue
 * const { theme, isDark, toggle, setTheme } = useTheme()
 * ```
 * 
 * FEATURES:
 * - Auto-detects system preference
 * - Persists choice in localStorage
 * - Smooth CSS transitions
 * - SSR-compatible
 */

type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme          // User preference
  resolvedTheme: 'light' | 'dark'  // Actual theme being applied
}

const STORAGE_KEY = 'f0-theme'

/**
 * Theme composable
 */
export function useTheme() {
  // State
  const state = useState<ThemeState>('theme', () => ({
    theme: 'system',
    resolvedTheme: 'light',
  }))
  
  /**
   * Get system color scheme preference
   */
  function getSystemTheme(): 'light' | 'dark' {
    if (import.meta.client) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }
    return 'light'
  }
  
  /**
   * Resolve the actual theme to apply
   */
  function resolveTheme(theme: Theme): 'light' | 'dark' {
    if (theme === 'system') {
      return getSystemTheme()
    }
    return theme
  }
  
  /**
   * Apply theme to document
   */
  function applyTheme(resolvedTheme: 'light' | 'dark') {
    if (import.meta.client) {
      document.documentElement.setAttribute('data-theme', resolvedTheme)
      
      // Also set color-scheme for native elements
      document.documentElement.style.colorScheme = resolvedTheme
    }
    
    state.value.resolvedTheme = resolvedTheme
  }
  
  /**
   * Set theme preference
   */
  function setTheme(theme: Theme) {
    state.value.theme = theme
    
    // Persist to localStorage
    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEY, theme)
    }
    
    // Apply resolved theme
    const resolved = resolveTheme(theme)
    applyTheme(resolved)
  }
  
  /**
   * Toggle between light and dark
   */
  function toggle() {
    const newTheme = state.value.resolvedTheme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
  }
  
  /**
   * Initialize theme on client
   */
  function initTheme() {
    if (!import.meta.client) return
    
    // Load saved preference
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null
    
    if (saved && ['light', 'dark', 'system'].includes(saved)) {
      state.value.theme = saved
    }
    
    // Apply theme
    const resolved = resolveTheme(state.value.theme)
    applyTheme(resolved)
    
    // Listen for system preference changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', (e) => {
      if (state.value.theme === 'system') {
        applyTheme(e.matches ? 'dark' : 'light')
      }
    })
  }
  
  // Computed properties
  const isDark = computed(() => state.value.resolvedTheme === 'dark')
  const isLight = computed(() => state.value.resolvedTheme === 'light')
  const isSystem = computed(() => state.value.theme === 'system')
  
  // Initialize on client
  if (import.meta.client) {
    onMounted(() => {
      initTheme()
    })
  }
  
  return {
    // State
    theme: computed(() => state.value.theme),
    resolvedTheme: computed(() => state.value.resolvedTheme),
    isDark,
    isLight,
    isSystem,
    
    // Methods
    setTheme,
    toggle,
    initTheme,
  }
}
