# =============================================================================
# F0 - PRODUCTION DOCKERFILE
# =============================================================================
#
# Targets:
#   site    (default) the app plus this repository's content/ and private/.
#           What Coolify builds for a site repository.
#   engine  the app with empty content/ and private/ directories: one image
#           for every site, with content mounted or layered on top.
#
# Content is copied LAST. The build stage never sees content/, private/, docs
# or tests, so a content-only change reuses the cached app build and only
# rewrites the small content layer.
#
# Usage:
#   docker build -t my-site .                     # site image
#   docker build --target engine -t f0-engine .   # shared engine image
#   docker run -p 3000:3000 -v ./content:/app/content f0-engine

# Base image: Node 24 LTS (Node 20 reached end of life on 2026-04-30), pinned to an
# exact version and multi-arch digest so builds are reproducible. Bump deliberately.
ARG NODE_IMAGE=node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

# =============================================================================
# deps: install dependencies (cached until package*.json changes)
# =============================================================================
FROM ${NODE_IMAGE} AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# Install all dependencies (dev dependencies are needed to build)
RUN npm ci --no-audit --no-fund

# =============================================================================
# src: split the build context into app source and site files
# =============================================================================
# Re-runs on every change, but it is only a copy. The builder below copies the
# app source from here; BuildKit and the classic builder both cache COPY by
# file checksums, so when only site files change the app build is reused.
FROM ${NODE_IMAGE} AS src

WORKDIR /src

COPY . .

RUN mkdir -p content private /site \
 && mv content private /site/ \
 && rm -rf docs test templates ./*.md

# =============================================================================
# builder: build the Nuxt application from app source only
# =============================================================================
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=src /src ./

# The build reads no environment variables (settings are read at startup),
# so nothing here can leak into the image or bust the build cache.
RUN npm run build

# =============================================================================
# engine: the runtime image without any site content
# =============================================================================
FROM ${NODE_IMAGE} AS engine

WORKDIR /app

# Non-root user
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nuxtjs

# Copy the built server with the right owner in one layer (no chown -R pass,
# which used to duplicate the whole .output into a second 63MB layer)
COPY --from=builder --chown=1001:1001 /app/.output ./.output
COPY --from=builder --chown=1001:1001 /app/package.json ./package.json

# Empty, writable content and private directories for mounts or a site layer
RUN mkdir -p content private && chown 1001:1001 content private

USER nuxtjs

EXPOSE 3000

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Optional image defaults for the public site metadata. The runtime
# environment (NUXT_PUBLIC_*) overrides them. Never pass secrets as build args.
ARG NUXT_PUBLIC_SITE_NAME=f0
ARG NUXT_PUBLIC_SITE_DESCRIPTION=Documentation
ENV NUXT_PUBLIC_SITE_NAME=$NUXT_PUBLIC_SITE_NAME
ENV NUXT_PUBLIC_SITE_DESCRIPTION=$NUXT_PUBLIC_SITE_DESCRIPTION

# Probe the readiness endpoint, not '/': '/' is a full server render (and a
# redirect in private mode). 127.0.0.1, not localhost: BusyBox wget may resolve
# localhost to ::1 while the server listens on IPv4. Coolify uses this
# healthcheck for Dockerfile-based apps.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/_ready || exit 1

CMD ["node", ".output/server/index.mjs"]

# =============================================================================
# site (default): engine + this repository's content and private files
# =============================================================================
FROM engine AS site

COPY --from=src --chown=1001:1001 /site/content ./content
COPY --from=src --chown=1001:1001 /site/private ./private
