# =============================================================================
# LITEDOCS - PRODUCTION DOCKERFILE
# =============================================================================
#
# Multi-stage build for optimal image size:
# 1. deps    - Install dependencies
# 2. builder - Build the Nuxt application
# 3. runner  - Minimal production image
#
# Usage:
#   docker build -t f0 .
#   docker run -p 3000:3000 -v ./content:/app/content f0
#
# For Coolify:
#   - Set build context to repository root
#   - Configure persistent volumes for /app/content and /app/private

# Base image: Node 24 LTS (Node 20 reached end of life on 2026-04-30), pinned to an
# exact version and multi-arch digest so builds are reproducible. Bump deliberately.
ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

# =============================================================================
# STAGE 1: Dependencies
# =============================================================================
FROM ${NODE_IMAGE} AS deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (dev dependencies are needed to build)
RUN npm ci --no-audit --no-fund

# =============================================================================
# STAGE 2: Builder
# =============================================================================
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments (can be overridden at build time)
ARG NUXT_PUBLIC_SITE_NAME=LiteDocs
ARG NUXT_PUBLIC_SITE_DESCRIPTION=Documentation

# Set build-time environment variables
ENV NUXT_PUBLIC_SITE_NAME=$NUXT_PUBLIC_SITE_NAME
ENV NUXT_PUBLIC_SITE_DESCRIPTION=$NUXT_PUBLIC_SITE_DESCRIPTION

# Build the application
RUN npm run build

# =============================================================================
# STAGE 3: Runner (Production)
# =============================================================================
FROM ${NODE_IMAGE} AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nuxtjs

# Copy built application
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json

# Copy content directories (will be overridden by volumes in production)
COPY --from=builder /app/content ./content
COPY --from=builder /app/private ./private

# Set ownership
RUN chown -R nuxtjs:nodejs /app

# Switch to non-root user
USER nuxtjs

# Expose port
EXPOSE 3000

# Environment variables (set at runtime)
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

# Start the application
CMD ["node", ".output/server/index.mjs"]
