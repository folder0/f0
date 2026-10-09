# =============================================================================
# f0 site image: this repository's content on top of the shared f0 engine
# =============================================================================
#
# The app is not built here. It comes from the engine image, published by
# f0's release workflow after its tests pass. A content change builds in
# seconds; upgrading f0 means changing F0_IMAGE, nothing else.
#
# Pin a version tag or, better, a digest:
#   ghcr.io/adeinnovates/f0:1.0.0
#   ghcr.io/adeinnovates/f0@sha256:<digest>
# Coolify: set F0_IMAGE as a build-time variable to override per site.
#
# Settings (NUXT_AUTH_MODE, NUXT_JWT_SECRET, ...) are runtime environment
# only. Never pass secrets as build arguments.
ARG F0_IMAGE=ghcr.io/adeinnovates/f0:latest
FROM ${F0_IMAGE}

COPY --chown=1001:1001 private/ /app/private/
COPY --chown=1001:1001 content/ /app/content/
