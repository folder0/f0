<!--
  =============================================================================
  F0 - LOGIN PAGE
  =============================================================================
  
  OTP-based authentication flow:
  1. User enters email
  2. System sends OTP to email
  3. User enters OTP
  4. On success, redirect to requested page or home
  
  This page is only shown when AUTH_MODE=private
-->

<template>
  <div class="login-container">
    <Head>
      <Title>Login - {{ siteName }}</Title>
    </Head>
    
    <div class="login-card">
      <!-- Logo/Title -->
      <div class="login-header">
        <h1 class="login-title">{{ siteName }}</h1>
        <p class="login-subtitle">
          {{ step === 'email' ? 'Enter your email to access the documentation' : 'Enter the verification code sent to your email' }}
        </p>
      </div>
      
      <!-- Email Step -->
      <form v-if="step === 'email'" @submit.prevent="requestOtp" class="login-form">
        <div class="form-group">
          <label for="email" class="form-label">Email address</label>
          <input
            id="email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            required
            autocomplete="email"
            :disabled="loading"
          />
        </div>
        
        <p v-if="error" class="form-error">{{ error }}</p>
        
        <button type="submit" class="btn btn-primary" :disabled="loading || !email">
          {{ loading ? 'Sending...' : 'Continue' }}
        </button>
      </form>
      
      <!-- OTP Step -->
      <form v-else @submit.prevent="verifyOtp" class="login-form">
        <div class="form-group">
          <label for="otp" class="form-label">Verification code</label>
          <p class="form-hint">Sent to {{ email }}</p>
          <input
            id="otp"
            v-model="otp"
            type="text"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="8"
            placeholder="12345678"
            required
            autocomplete="one-time-code"
            :disabled="loading"
            class="otp-input-field"
          />
        </div>
        
        <p v-if="error" class="form-error">{{ error }}</p>
        
        <p v-if="attemptsRemaining !== null && attemptsRemaining < 3" class="form-warning">
          {{ attemptsRemaining }} attempt{{ attemptsRemaining === 1 ? '' : 's' }} remaining
        </p>
        
        <button type="submit" class="btn btn-primary" :disabled="loading || otp.length < 8">
          {{ loading ? 'Verifying...' : 'Verify' }}
        </button>
        
        <div class="login-actions">
          <button type="button" class="btn btn-ghost" @click="backToEmail">
            ← Use different email
          </button>
          <button 
            type="button" 
            class="btn btn-ghost" 
            @click="resendOtp"
            :disabled="resendCooldown > 0"
          >
            {{ resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code' }}
          </button>
        </div>
      </form>
    </div>
    
    <!-- Footer -->
    <p class="login-footer">
      Protected documentation powered by f0
    </p>
  </div>
</template>

<script setup lang="ts">
// ---------------------------------------------------------------------------
// LAYOUT
// ---------------------------------------------------------------------------

// Use a blank layout for login (no sidebar/header)
definePageMeta({
  layout: false,
})

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const config = useRuntimeConfig()
const siteName = config.public.siteName || 'f0'
const route = useRoute()
const router = useRouter()
const { login } = useAuth()

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------

const step = ref<'email' | 'otp'>('email')
const email = ref('')
const otp = ref('')
const loading = ref(false)
const error = ref('')
const attemptsRemaining = ref<number | null>(null)
const resendCooldown = ref(0)

// ---------------------------------------------------------------------------
// RESEND COOLDOWN TIMER
// ---------------------------------------------------------------------------

let cooldownInterval: ReturnType<typeof setInterval> | null = null

function startResendCooldown() {
  resendCooldown.value = 60 // 60 seconds
  
  cooldownInterval = setInterval(() => {
    resendCooldown.value--
    if (resendCooldown.value <= 0 && cooldownInterval) {
      clearInterval(cooldownInterval)
      cooldownInterval = null
    }
  }, 1000)
}

onUnmounted(() => {
  if (cooldownInterval) {
    clearInterval(cooldownInterval)
  }
})

// ---------------------------------------------------------------------------
// REQUEST OTP
// ---------------------------------------------------------------------------

async function requestOtp() {
  if (!email.value) return
  
  loading.value = true
  error.value = ''
  
  try {
    const response = await $fetch('/api/auth/request-otp', {
      method: 'POST',
      body: { email: email.value },
    })
    
    // Move to OTP step
    step.value = 'otp'
    startResendCooldown()
  } catch (err: any) {
    error.value = err.data?.message || err.data?.data?.message || 'Failed to send verification code'
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------------------
// VERIFY OTP
// ---------------------------------------------------------------------------

async function verifyOtp() {
  if (!otp.value || otp.value.length < 8) return
  
  loading.value = true
  error.value = ''
  
  try {
    const response = await $fetch<{ token: string }>('/api/auth/verify-otp', {
      method: 'POST',
      body: { 
        email: email.value,
        code: otp.value,
      },
    })
    
    // Store token and redirect
    login(response.token)
    
    // Redirect to original destination or home
    const redirect = route.query.redirect as string || '/'
    router.push(redirect)
  } catch (err: any) {
    const data = err.data?.data || err.data || {}
    error.value = data.message || 'Invalid verification code'
    
    // Track remaining attempts
    if (typeof data.attemptsRemaining === 'number') {
      attemptsRemaining.value = data.attemptsRemaining
      
      // If no attempts remaining, go back to email step
      if (data.attemptsRemaining === 0) {
        setTimeout(() => {
          backToEmail()
          error.value = 'Too many failed attempts. Please request a new code.'
        }, 2000)
      }
    }
    
    // Clear OTP input on error
    otp.value = ''
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------------------
// RESEND OTP
// ---------------------------------------------------------------------------

async function resendOtp() {
  if (resendCooldown.value > 0) return
  
  loading.value = true
  error.value = ''
  
  try {
    await $fetch('/api/auth/request-otp', {
      method: 'POST',
      body: { email: email.value },
    })
    
    startResendCooldown()
    attemptsRemaining.value = null
    otp.value = ''
  } catch (err: any) {
    error.value = err.data?.message || err.data?.data?.message || 'Failed to resend code'
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------------------
// BACK TO EMAIL
// ---------------------------------------------------------------------------

function backToEmail() {
  step.value = 'email'
  otp.value = ''
  error.value = ''
  attemptsRemaining.value = null
  
  if (cooldownInterval) {
    clearInterval(cooldownInterval)
    cooldownInterval = null
  }
  resendCooldown.value = 0
}
</script>

<style scoped>
.login-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-6);
  background-color: var(--color-bg-secondary);
}

.login-card {
  width: 100%;
  max-width: 400px;
  padding: var(--spacing-8);
  background-color: var(--color-bg-primary);
  border: 1px solid var(--color-border-primary);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
}

.login-header {
  text-align: center;
  margin-bottom: var(--spacing-6);
}

.login-title {
  font-size: var(--font-size-2xl);
  margin: 0 0 var(--spacing-2);
}

.login-subtitle {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.form-label {
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.form-hint {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  margin: 0;
}

.form-error {
  font-size: var(--font-size-sm);
  color: var(--color-error);
  margin: 0;
}

.form-warning {
  font-size: var(--font-size-sm);
  color: var(--color-warning);
  margin: 0;
}

.otp-input-field {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xl);
  letter-spacing: 0.2em;
  text-align: center;
}

.login-actions {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-2);
  margin-top: var(--spacing-2);
}

.login-actions .btn {
  font-size: var(--font-size-sm);
  padding: var(--spacing-2);
}

.login-footer {
  margin-top: var(--spacing-8);
  font-size: var(--font-size-xs);
  color: var(--color-text-tertiary);
}
</style>
