/**
 * =============================================================================
 * F0 - AUTHENTICATION COMPOSABLE
 * =============================================================================
 * 
 * Client-side authentication state management.
 * 
 * USAGE:
 * ```vue
 * const { isAuthenticated, user, login, logout } = useAuth()
 * ```
 * 
 * FEATURES:
 * - Reactive authentication state
 * - OTP request and verification
 * - Token management
 * - Automatic redirect after login
 */

interface User {
  email: string
}

interface AuthState {
  isAuthenticated: boolean
  user: User | null
  loading: boolean
  error: string | null
}

interface RequestOtpResult {
  success: boolean
  error?: string
}

interface VerifyOtpResult {
  success: boolean
  error?: string
  attemptsRemaining?: number
}

/**
 * Authentication composable
 */
export function useAuth() {
  // State
  const state = useState<AuthState>('auth', () => ({
    isAuthenticated: false,
    user: null,
    loading: true,
    error: null,
  }))
  
  const config = useRuntimeConfig()
  const router = useRouter()
  
  /**
   * Check if authentication is enabled
   */
  const authEnabled = computed(() => {
    // In client, we check by attempting to access protected routes
    // The actual mode is set server-side
    return true // Assume enabled, server will redirect if not
  })
  
  /**
   * Initialize auth state from stored token
   */
  async function initAuth() {
    state.value.loading = true
    
    // Check for token in localStorage
    if (import.meta.client) {
      const token = localStorage.getItem('litedocs_token')
      
      if (token) {
        try {
          // Verify token by decoding (basic check)
          const payload = parseJwt(token)
          
          if (payload && payload.exp && payload.exp * 1000 > Date.now()) {
            state.value.isAuthenticated = true
            state.value.user = { email: payload.email }
          } else {
            // Token expired
            localStorage.removeItem('litedocs_token')
          }
        } catch {
          localStorage.removeItem('litedocs_token')
        }
      }
    }
    
    state.value.loading = false
  }
  
  /**
   * Parse JWT payload (client-side only, no verification)
   */
  function parseJwt(token: string): { email: string; exp: number } | null {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      
      const payload = JSON.parse(atob(parts[1]))
      return payload
    } catch {
      return null
    }
  }
  
  /**
   * Request OTP for email
   */
  async function requestOtp(email: string): Promise<RequestOtpResult> {
    state.value.error = null
    
    try {
      const response = await $fetch('/api/auth/request-otp', {
        method: 'POST',
        body: { email },
      })
      
      return { success: true }
    } catch (error: any) {
      const message = error.data?.message || 'Failed to send verification code'
      state.value.error = message
      return { success: false, error: message }
    }
  }
  
  /**
   * Verify OTP and complete login
   */
  async function verifyOtp(email: string, code: string): Promise<VerifyOtpResult> {
    state.value.error = null
    
    try {
      const response = await $fetch<{
        success: boolean
        token: string
        user: User
      }>('/api/auth/verify-otp', {
        method: 'POST',
        body: { email, code },
      })
      
      if (response.success && response.token) {
        // Store token
        if (import.meta.client) {
          localStorage.setItem('litedocs_token', response.token)
        }
        
        // Update state
        state.value.isAuthenticated = true
        state.value.user = response.user
        
        return { success: true }
      }
      
      return { success: false, error: 'Verification failed' }
    } catch (error: any) {
      const message = error.data?.message || 'Verification failed'
      const attemptsRemaining = error.data?.attemptsRemaining
      
      state.value.error = message
      return { success: false, error: message, attemptsRemaining }
    }
  }
  
  /**
   * Login with token (used after OTP verification or for direct token injection)
   */
  function login(token: string) {
    if (import.meta.client) {
      localStorage.setItem('litedocs_token', token)
    }
    
    // Parse token to get user info
    const payload = parseJwt(token)
    if (payload) {
      state.value.isAuthenticated = true
      state.value.user = { email: payload.email }
    }
  }
  
  /**
   * Logout user
   */
  function logout() {
    if (import.meta.client) {
      localStorage.removeItem('litedocs_token')
    }
    
    state.value.isAuthenticated = false
    state.value.user = null
    
    // Redirect to login
    router.push('/login')
  }
  
  /**
   * Get authorization header for API requests
   */
  function getAuthHeader(): Record<string, string> {
    if (import.meta.client) {
      const token = localStorage.getItem('litedocs_token')
      if (token) {
        return { Authorization: `Bearer ${token}` }
      }
    }
    return {}
  }
  
  // Initialize on mount
  if (import.meta.client) {
    onMounted(() => {
      initAuth()
    })
  }
  
  return {
    // State
    isAuthenticated: computed(() => state.value.isAuthenticated),
    user: computed(() => state.value.user),
    loading: computed(() => state.value.loading),
    error: computed(() => state.value.error),
    authEnabled,
    
    // Methods
    login,
    requestOtp,
    verifyOtp,
    logout,
    getAuthHeader,
    initAuth,
  }
}
