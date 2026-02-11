/**
 * =============================================================================
 * F0 - SEARCH COMPOSABLE
 * =============================================================================
 * 
 * Manages search state and provides search functionality.
 * Keyboard shortcut (Cmd/Ctrl+K) is registered once globally.
 */

interface SearchResult {
  title: string
  path: string
  excerpt: string
  section: string
}

interface SearchState {
  isOpen: boolean
  query: string
  results: SearchResult[]
  isLoading: boolean
  error: string | null
}

// Debounce timer
let searchTimeout: ReturnType<typeof setTimeout> | null = null

// Global listener flag — only register once per app lifetime
let globalListenerRegistered = false

export function useSearch() {
  const router = useRouter()
  
  // Shared state across components
  const state = useState<SearchState>('search', () => ({
    isOpen: false,
    query: '',
    results: [],
    isLoading: false,
    error: null,
  }))
  
  function openSearch() {
    state.value.isOpen = true
    state.value.query = ''
    state.value.results = []
    state.value.error = null
  }
  
  function closeSearch() {
    state.value.isOpen = false
    state.value.query = ''
    state.value.results = []
  }
  
  function toggleSearch() {
    if (state.value.isOpen) {
      closeSearch()
    } else {
      openSearch()
    }
  }
  
  function search(query: string) {
    state.value.query = query
    
    if (searchTimeout) {
      clearTimeout(searchTimeout)
    }
    
    if (query.trim().length < 2) {
      state.value.results = []
      state.value.isLoading = false
      return
    }
    
    state.value.isLoading = true
    
    searchTimeout = setTimeout(async () => {
      try {
        const response = await $fetch<{ results: SearchResult[] }>('/api/search', {
          params: { q: query },
        })
        
        state.value.results = response.results
        state.value.error = null
      } catch (e) {
        console.error('[Search] Error:', e)
        state.value.error = 'Search failed. Please try again.'
        state.value.results = []
      } finally {
        state.value.isLoading = false
      }
    }, 200)
  }
  
  function goToResult(result: SearchResult) {
    closeSearch()
    router.push(result.path)
  }
  
  /**
   * Register global keyboard shortcuts — safe to call multiple times,
   * only registers once per client session. No cleanup needed since
   * the listener persists for the app lifetime.
   */
  function setupKeyboardShortcuts() {
    if (!import.meta.client) return
    if (globalListenerRegistered) return
    
    globalListenerRegistered = true
    
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to toggle search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleSearch()
      }
      
      // Escape to close
      if (e.key === 'Escape' && state.value.isOpen) {
        closeSearch()
      }
    })
  }
  
  // Auto-register on first client-side use
  if (import.meta.client) {
    setupKeyboardShortcuts()
  }
  
  return {
    isOpen: computed(() => state.value.isOpen),
    query: computed(() => state.value.query),
    results: computed(() => state.value.results),
    isLoading: computed(() => state.value.isLoading),
    error: computed(() => state.value.error),
    openSearch,
    closeSearch,
    toggleSearch,
    search,
    goToResult,
    setupKeyboardShortcuts,
  }
}
