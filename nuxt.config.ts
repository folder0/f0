/**
 * =============================================================================
 * LITEDOCS - NUXT CONFIGURATION
 * =============================================================================
 * 
 * This configuration file sets up Nuxt 3 for the f0 documentation platform.
 * 
 * Key decisions:
 * - SSR enabled for SEO and fast initial page loads
 * - Runtime config separates public (browser) vs private (server-only) env vars
 * - Nitro configured to protect /private directory from public access
 * - CSS uses a custom theme with light/dark mode support
 * 
 * Environment Variables Required:
 * - AUTH_MODE: 'public' | 'private' (controls whether auth is required)
 * - JWT_SECRET: Secret key for signing JWTs (required in private mode)
 * - AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY: For SES email
 * - EMAIL_FROM: Sender email address
 * - NUXT_PUBLIC_GTAG_ID: Optional Google Analytics ID
 */

export default defineNuxtConfig({
  // ---------------------------------------------------------------------------
  // CORE SETTINGS
  // ---------------------------------------------------------------------------
  
  // Enable Vue devtools in development
  devtools: { enabled: true },

  // Enable server-side rendering for SEO and AI crawlers
  ssr: true,

  // ---------------------------------------------------------------------------
  // RUNTIME CONFIGURATION
  // ---------------------------------------------------------------------------
  // These values are available at runtime and can be overridden by env vars
  // Public values are exposed to the browser; private values are server-only
  
  runtimeConfig: {
    // Private keys (server-only) - never exposed to client
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
    
    // AWS SES Configuration
    awsRegion: process.env.AWS_REGION || 'us-east-1',
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    emailFrom: process.env.EMAIL_FROM || 'no-reply@example.com',
    
    // Auth mode: 'public' (no auth) or 'private' (require login)
    authMode: process.env.AUTH_MODE || 'public',
    
    // Content directory paths (relative to project root)
    contentDir: process.env.CONTENT_DIR || './content',
    privateDir: process.env.PRIVATE_DIR || './private',

    // f0 mode: 'docs' (default) or 'blog' (convenience for pure-blog sites)
    f0Mode: process.env.F0_MODE || 'docs',

    // Public keys (exposed to client)
    public: {
      // Google Analytics - only injected if set
      gtagId: process.env.NUXT_PUBLIC_GTAG_ID || '',
      
      // Site metadata
      siteName: process.env.NUXT_PUBLIC_SITE_NAME || 'f0',
      siteDescription: process.env.NUXT_PUBLIC_SITE_DESCRIPTION || 'Documentation',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || '',
    }
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
