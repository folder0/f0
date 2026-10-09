/**
 * =============================================================================
 * F0 - NUXT CONFIGURATION
 * =============================================================================
 *
 * This configuration file sets up Nuxt 4 for the f0 documentation platform.
 * The pre-Nuxt-4 directory layout (pages/, components/ ... at the root) is
 * kept on purpose: Nuxt 4 detects it, and forks merge without file moves.
 *
 * Key decisions:
 * - SSR enabled for SEO and fast initial page loads
 * - No environment variable is read here. Whatever this file reads at build
 *   time is frozen into the server bundle (and the image), so secrets would
 *   leak and runtime-only settings would be ignored. Server settings (auth
 *   mode, secrets, SES, directories) are read at startup by
 *   server/utils/f0-config.ts; public site metadata comes from NUXT_PUBLIC_*
 *   at runtime.
 * - Nitro configured to protect /private directory from public access
 * - CSS uses a custom theme with light/dark mode support
 *
 * Environment variables (all read at runtime, see README):
 * - NUXT_AUTH_MODE / AUTH_MODE: 'public' | 'private'
 * - NUXT_JWT_SECRET / JWT_SECRET: required in private mode
 * - NUXT_AWS_REGION, NUXT_AWS_ACCESS_KEY_ID, NUXT_AWS_SECRET_ACCESS_KEY, NUXT_EMAIL_FROM
 * - NUXT_PUBLIC_SITE_NAME, NUXT_PUBLIC_SITE_DESCRIPTION, NUXT_PUBLIC_SITE_URL, NUXT_PUBLIC_GTAG_ID
 */

export default defineNuxtConfig({
  // ---------------------------------------------------------------------------
  // CORE SETTINGS
  // ---------------------------------------------------------------------------
  
  // Vue devtools: development only. Enabling it unconditionally loads the
  // @nuxt/devtools module into production builds as well.
  devtools: { enabled: false },
  $development: {
    devtools: { enabled: true },
  },

  // Enable server-side rendering for SEO and AI crawlers
  ssr: true,

  // ---------------------------------------------------------------------------
  // RUNTIME CONFIGURATION
  // ---------------------------------------------------------------------------
  // Literal defaults only (see the header). Nuxt overrides each public value
  // from NUXT_PUBLIC_* when the server starts.

  runtimeConfig: {
    public: {
      // Google Analytics - only injected if set
      gtagId: '',

      // Site metadata
      siteName: 'f0',
      siteDescription: 'Documentation',
      siteUrl: '',

      // Real-user metrics (Core Web Vitals) to the server log; off unless
      // NUXT_PUBLIC_RUM=true. NUXT_PUBLIC_RUM_SAMPLE is the share of page
      // loads that report (0 to 1).
      rum: false,
      rumSample: 1,
    },
  },

  // ---------------------------------------------------------------------------
  // CSS CONFIGURATION
  // ---------------------------------------------------------------------------
  // CSS stylesheets
  
  css: [
    '~/assets/css/main.css',             // Core theme (light + dark mode)
    '~/assets/css/blog.css',             // Blog-specific styles
  ],

  // ---------------------------------------------------------------------------
  // APP CONFIGURATION
  // ---------------------------------------------------------------------------
  
  app: {
    // Default page head configuration
    head: {
      htmlAttrs: {
        lang: 'en',
      },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
      link: [
        // Inter font from Google Fonts for Notion-like typography
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { 
          rel: 'stylesheet', 
          href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap' 
        },
      ],
      // Inline script to prevent theme flash - runs before page renders
      script: [
        {
          innerHTML: `
            (function() {
              try {
                var theme = localStorage.getItem('f0-theme');
                if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.setAttribute('data-theme', 'dark');
                  document.documentElement.style.colorScheme = 'dark';
                } else {
                  document.documentElement.setAttribute('data-theme', 'light');
                  document.documentElement.style.colorScheme = 'light';
                }
              } catch (e) {}
            })();
          `,
          type: 'text/javascript',
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // NITRO (SERVER) CONFIGURATION
  // ---------------------------------------------------------------------------
  
  nitro: {
    // Security: Prevent serving files from /private directory
    // This is CRITICAL - allowlist.json must never be publicly accessible
    publicAssets: [
      {
        dir: 'public',
        maxAge: 60 * 60 * 24 * 365, // 1 year cache for static assets
      }
    ],
    
    // Route rules for caching and security
    routeRules: {
      // Static assets - aggressive caching
      '/assets/**': { 
        headers: { 'cache-control': 'public, max-age=31536000, immutable' } 
      },
      
      // Content images - moderate caching
      '/api/content/assets/**': { 
        headers: { 'cache-control': 'public, max-age=86400' } 
      },
      
      // llms.txt - short cache to ensure freshness
      '/llms.txt': { 
        headers: { 
          'cache-control': 'public, max-age=3600',
          'content-type': 'text/plain; charset=utf-8'
        } 
      },
      
      // llms-index.txt - same caching as llms.txt
      '/llms-index.txt': {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-type': 'text/plain; charset=utf-8'
        }
      },
      
      // Sitemap - moderate cache
      '/sitemap.xml': {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-type': 'application/xml; charset=utf-8'
        }
      },
      
      // RSS feed - moderate cache
      '/feed.xml': {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-type': 'application/rss+xml; charset=utf-8'
        }
      },
      
      // API routes - no caching
      '/api/**': { 
        headers: { 'cache-control': 'no-store' } 
      },
      
      // Health/readiness endpoints - no caching, fast response
      '/_health': {
        headers: { 'cache-control': 'no-store' }
      },
      '/_ready': {
        headers: { 'cache-control': 'no-store' }
      },
    },
  },

  // ---------------------------------------------------------------------------
  // COMPONENT AUTO-IMPORT
  // ---------------------------------------------------------------------------
  // Blog components use explicit Blog prefix in filenames (e.g. BlogIndex.vue)
  // so we disable pathPrefix for that directory to avoid double-prefixing.
  
  components: [
    { path: '~/components/blog', pathPrefix: false },
    { path: '~/components' },
  ],

  // ---------------------------------------------------------------------------
  // TYPESCRIPT CONFIGURATION
  // ---------------------------------------------------------------------------
  
  typescript: {
    strict: true,
    // Disable type checking during dev - run 'npm run typecheck' separately
    typeCheck: false,
  },

  // ---------------------------------------------------------------------------
  // MODULE CONFIGURATION
  // ---------------------------------------------------------------------------
  // We intentionally avoid @nuxt/content module to keep filesystem as pure truth
  // This aligns with constraint C-ARCH-FILESYSTEM-SOT-001
  
  modules: [
    // Add modules here as needed (e.g., @nuxtjs/color-mode for theme)
  ],

  // ---------------------------------------------------------------------------
  // COMPATIBILITY
  // ---------------------------------------------------------------------------
  
  compatibilityDate: '2024-01-01',
})
