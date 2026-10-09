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
 * - Automatic redirect after login
 *
 * SESSIONS: the session token lives only in the httpOnly `f0_token` cookie,
 * which page scripts cannot read. State comes from GET /api/auth/session.
 * Earlier versions also kept the token in localStorage; it is removed there
 * on first load.
 */

/** localStorage key used by earlier versions to hold the session token. */
const LEGACY_TOKEN_KEY = 'f0_token'

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
   * Initialize auth state from the session cookie
   */
  async function initAuth() {
    state.value.loading = true

    if (import.meta.client) {
      // Drop a token left by earlier versions; the cookie is the session.
      try {
        localStorage.removeItem(LEGACY_TOKEN_KEY)
      }
      catch {
        // storage unavailable (private browsing, blocked site data)
      }

      try {
        const session = await $fetch<{ authenticated: boolean, user?: User }>('/api/auth/session')
        state.value.isAuthenticated = session.authenticated
        state.value.user = session.authenticated && session.user ? session.user : null
      }
      catch {
        state.value.isAuthenticated = false
        state.value.user = null
      }
    }

    state.value.loading = false
  }

  /**
   * Read the email from a JWT payload (no verification; display only)
   */
  function emailFromJwt(token: string): string | null {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
      return typeof payload?.email === 'string' ? payload.email : null
    }
    catch {
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
        user: User
      }>('/api/auth/verify-otp', {
        method: 'POST',
        body: { email, code },
      })
      
      if (response.success && response.user) {
        // The server set the httpOnly session cookie; only update state.
        login(response.user)
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
   * Mark the user as signed in after OTP verification. The session itself is
   * the cookie the server just set. Accepts the user from the verify response,
   * or (for older callers) a token, which is only read for the email and is
   * never stored.
   */
  function login(user: User | string) {
    const email = typeof user === 'string' ? emailFromJwt(user) : user?.email
    if (email) {
      state.value.isAuthenticated = true
      state.value.user = { email }
    }
  }
  
  /**
   * Logout user
   */
  async function logout() {
    if (import.meta.client) {
      // End the session on the server: revokes the token and clears the
      // httpOnly cookie. Ignore failures so logout never gets stuck.
      try {
        await $fetch('/api/auth/logout', { method: 'POST' })
      }
      catch {
        // fall through to local cleanup
      }
      try {
        localStorage.removeItem(LEGACY_TOKEN_KEY)
      }
      catch {
        // storage unavailable
      }
    }
    
    state.value.isAuthenticated = false
    state.value.user = null
    
    // Redirect to login
    router.push('/login')
  }
  
  /**
   * Authorization header for API requests. Same-origin requests carry the
   * session cookie automatically, so there is nothing to add; kept so
   * existing callers keep working.
   */
  function getAuthHeader(): Record<string, string> {
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
