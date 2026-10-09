# f0 (Folder Zero)

> A filesystem-based documentation engine that renders a single source of truth for **Humans** (UI), **Search Engines** (SEO), and **AI Agents** (LLM Context).

---

## The Philosophy

Documentation tools have become too complex. f0 strips away the database, the admin dashboard, and the configuration files.

**The Filesystem is the CMS.**

Write Markdown. Organize folders. Deploy. One source file renders three ways: a Vue.js interface for humans, SSR HTML for crawlers, and structured plain text for AI agents at `/llms.txt`.

---

## Quick Start

```bash
# Clone and run
git clone https://github.com/your-org/f0.git
cd f0
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You are done.

---

## Content Structure

There is no database. Your folder structure *is* the site structure.

```
content/
├── nav.md                       ← Top navigation bar (required)
├── home.md                      ← Landing page (renders at /)
├── _brand.md                    ← White-label branding (optional)
│
├── guides/                      ← Tab: "Guides"
│   ├── _config.md               ← Per-directory config
│   ├── 01-getting-started.md    ← Renders at /guides/getting-started
│   └── authentication/
│       └── overview.md          ← Renders at /guides/authentication/overview
│
├── blog/                        ← Tab: "Blog"
│   ├── _config.md               ← layout: blog
│   ├── 2026-02-08-first-post.md
│   └── 2026-02-11-second-post.md
│
├── api/                         ← Tab: "API"
│   └── openapi.json             ← Auto-rendered OpenAPI/Swagger spec
│
└── assets/
    ├── images/                  ← Content images (auto-optimized)
    └── css/
        └── custom.css           ← Custom CSS override (optional)
```

### Navigation (`nav.md`)

```markdown
- [Guides](/guides)
- [Blog](/blog)
- [API Reference](/api)
- [GitHub](https://github.com/your-org/f0)
```

Each list item maps to a top-level folder. External links are supported. Order in the file determines order in the header.

### File Ordering

Prefix filenames with numbers to control sidebar order. The prefix is stripped from URLs:

```
guides/
├── 01-getting-started.md    → /guides/getting-started
├── 02-configuration.md      → /guides/configuration
└── 03-deployment.md         → /guides/deployment
```

Blog posts use date prefixes: `2026-02-11-post-title.md` → `/blog/post-title`.

### Frontmatter

```yaml
---
title: Getting Started
description: Set up f0 in under 5 minutes
order: 1
---
```

Blog posts support additional fields: `date`, `author`, `tags`, `cover_image`, `excerpt`, `pinned`.

---

## Custom Markdown Syntax

f0 supports GitHub Flavored Markdown plus custom extensions.

### Callout Boxes

```markdown
:::info
Informational callout with full Markdown support inside.
:::

:::warning
Warning callout.
:::

:::error
Error/danger callout.
:::

:::success
Success callout.
:::
```

### API Endpoint Blocks

```markdown
:::api GET /users/{id}
Get user by ID

Retrieves a specific user by their unique identifier.
:::

:::api POST /users
Create user

Creates a new user account.
:::
```

Methods get colored badges: GET (green), POST (blue), PUT (orange), PATCH (purple), DELETE (red).

### Embeds

```markdown
::youtube[Video Title]{id=dQw4w9WgXcQ}
::embed[Walkthrough]{url=https://www.loom.com/share/abc123}
::embed[Design]{url=https://www.figma.com/file/xyz}
::embed[Code Sample]{url=https://gist.github.com/user/abc}
```

Supported: YouTube, Loom, Figma, GitHub Gists. Unknown URLs render as styled link cards.

### Tabs, Steps and Cards

````markdown
:::tabs
@tab npm
```bash
npm install f0
```
@tab pnpm
```bash
pnpm add f0
```
:::
````

`:::steps` numbers each `###` heading inside it; `:::cards` lays out a list of links as a grid. See [docs/CONTENT-GUIDE.md](docs/CONTENT-GUIDE.md).

### Partials

Markdown in `_partials/` renders around pages without touching code: `announcement.md` (banner on every page), `footer.md`, `doc-footer.md` (after docs pages) and `post-footer.md` (after blog posts; the nearest folder's file wins).

### Mermaid Diagrams

```markdown
::mermaid
graph TD
  A[Start] --> B[Process]
  B --> C[End]
::
```

Diagram source is preserved in `/llms.txt` so AI agents understand the structure.

---

## White-Label Branding

Deploy for any client without touching source code. Create `content/_brand.md`:

```yaml
---
logo: ./assets/images/logo.svg
logo_dark: ./assets/images/logo-dark.svg
favicon: ./assets/images/favicon.png
accent_color: "#2563eb"
header_style: logo_and_text
footer_text: "© 2026 Acme Corp. All rights reserved."
footer_links:
  - label: Privacy
    url: /privacy
  - label: Terms
    url: /terms
custom_css: ./assets/css/custom.css
og_image: ./assets/images/og-default.png
---
```

All fields optional. One Docker image serves unlimited branded deployments.

---

## Image Processing

Images are automatically optimized on demand via query parameters:

```
/api/content/assets/images/photo.png              → Original
/api/content/assets/images/photo.png?w=800&f=webp → 800px WebP
/api/content/assets/images/photo.png?w=400&q=80   → 400px, quality 80
```

The Markdown pipeline automatically wraps content images in responsive `<picture>` elements with WebP srcset at 400/800/1200w and lazy loading. Processed variants are cached on disk in `NUXT_IMAGE_CACHE_DIR` (default: the system temp directory, never inside `content/`). If sharp is unavailable, originals are served.

Image paths in Markdown (`./assets/images/x.png`) preview correctly in GitHub and VS Code.

---

## AI-First Documentation

f0 treats AI agents as first-class consumers.

### `/llms.txt` — Full Context

```
GET /llms.txt                        → All documentation (~3ms cached)
GET /llms.txt?section=guides         → Only /guides content
GET /llms.txt?section=api            → Only /api content
```

Output is plain text with hierarchical path headers, stripped of all UI chrome. Pre-computed at startup and cached with content-hash invalidation.

### `/llms-full.txt` — Full Context (llmstxt.org location)

The same full text as `/llms.txt`, at the location the [llms.txt convention](https://llmstxt.org) uses. **Notice:** a later release turns `/llms.txt` into the convention's short index of links; agents that want the full text should switch to `/llms-full.txt` now. `/llms.txt` responses carry a `Link` and an `X-F0-Notice` header saying so.

### `/llms-index.txt` — Discovery

```
# Acme Docs — Documentation Index

## Available Sections

/api          — 1 page, ~81 tokens
/blog         — 3 pages, ~1,144 tokens
/guides       — 4 pages, ~1,663 tokens

## Full Site: 9 pages, ~3,225 tokens
```

Agents read the index first, then fetch only the sections they need.

### `/mcp` — Model Context Protocol

AI tools that speak MCP (Claude, Cursor, VS Code and others) can use the site directly. Add it as a remote HTTP MCP server at `https://your-site/mcp`. It offers three read-only tools: `search_docs`, `read_page` (Markdown by path) and `list_pages` (sections and pages). On private sites, send the session token as `Authorization: Bearer <token>`; drafts and access rules are the same as for readers.

### `/api/agents/search` — Semantic Search

```
GET /api/agents/search?q=authentication&limit=5&include_content=true
```

---

## SEO

Auto-generated for every deployment:

- **`/sitemap.xml`** — All pages with `lastmod`, `changefreq`, `priority`
- **OpenGraph meta** — `og:title`, `og:description`, `og:image`, `og:url` on every page
- **Twitter Cards** — `summary_large_image` when cover image present
- **Canonical URLs** — `<link rel="canonical">` from `NUXT_PUBLIC_SITE_URL`
- **`/feed.xml`** — RSS feed for blog content
- **`Server-Timing`** header on every response

---

## Private Mode (Lite-Auth)

Secure internal documentation with email OTP — no Identity Provider required.

```bash
NUXT_AUTH_MODE=private
```

Add authorized emails to `/private/allowlist.json`:

```json
{
  "emails": ["alice@company.com", "bob@company.com"],
  "domains": ["company.com"],
  "admins": ["alice@company.com"]
}
```

`admins` lists who may use the admin API (content upload, audit logs). If it is missing or empty, nobody is an admin.

Configure AWS SES for email delivery. Flow: email challenge → 8-digit OTP → JWT token → access granted. In the browser the session lives only in an httpOnly cookie that page scripts cannot read; `GET /api/auth/session` reports who is signed in. API clients can send the token returned by `/api/auth/verify-otp` as `Authorization: Bearer <token>`. Logging out revokes the session immediately, and removing someone from the allowlist ends their access on their next request.

---

## Infrastructure

### Health Probes

```
GET /_health    → Liveness (always 200 if process alive, includes cache stats)
GET /_ready     → Readiness (content directory readable and startup warm-up finished)
```

Both bypass auth in private mode.

### Startup Validation

On boot, f0 validates the deployment environment before accepting traffic:

1. Content directory exists (fatal if missing)
2. `nav.md` present (warn if missing)
3. Auth config valid (fatal if `AUTH_MODE=private` without allowlist)
4. Pre-warm all content caches (every page parsed at startup)
5. Pre-compute `/llms.txt` (ready for first AI request)

### Performance

- **Content cache** — mtime-based invalidation, ~1ms cached responses
- **Navigation cache** — mtime + directory structure hash
- **`/llms.txt` cache** — content-hash invalidation, ~3ms cached
- **Image cache** — disk-based, keyed by source path, mtime and size; in memory if the directory is not writable
- **Structured JSON logs** — all server output, zero `console.log`

### Content Validation CLI

```bash
npm run validate -- ./content
```

Checks: frontmatter YAML, image references, heading hierarchy, title resolution, nav.md links, duplicate slugs, file size, encoding. Exit 1 on errors for CI/CD gating.

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/content/[...slug]` | GET | Rendered page content |
| `/api/navigation` | GET | Navigation structure |
| `/api/brand` | GET | White-label configuration |
| `/api/search?q=` | GET | Content search |
| `/api/blog?path=` | GET | Blog post listings |
| `/api/agents/search?q=` | GET | AI semantic search |
| `/api/content/raw/[...slug]` | GET | Raw Markdown source |
| `/<page>.md` | GET | The same Markdown source at the page's own URL plus `.md` (`/guides/intro.md`, `/home.md`); pages link to it with `rel="alternate" type="text/markdown"` |
| `/api/content/assets/[...path]` | GET | Static assets (with image processing) |
| `/llms.txt` | GET | AI-optimized content stream |
| `/llms-index.txt` | GET | Section index with token estimates |
| `/sitemap.xml` | GET | Auto-generated XML sitemap |
| `/feed.xml` | GET | RSS feed |
| `/_health` | GET | Liveness probe |
| `/_ready` | GET | Readiness probe |
| `/api/auth/request-otp` | POST | Request OTP (private mode) |
| `/api/auth/verify-otp` | POST | Verify OTP (private mode) |
| `/api/auth/session` | GET | Who is signed in (from the session cookie) |
| `/mcp` | POST | Model Context Protocol server (search, read and list pages) |
| `/api/auth/logout` | POST | End the session and clear the cookie |
| `/api/webhook` | POST | GitHub webhook for content sync |

---

## Deployment

### Docker

```bash
docker build -t f0 .

docker run -p 3000:3000 \
  -v $(pwd)/content:/app/content \
  -e NUXT_AUTH_MODE=public \
  -e NUXT_PUBLIC_SITE_NAME="Acme Docs" \
  -e NUXT_PUBLIC_SITE_URL="https://docs.acme.com" \
  f0
```

### Production Build

```bash
npm run build
node .output/server/index.mjs
```

### Environment Variables

All settings are read when the server starts, from the runtime environment. Nothing is read at build time, so values that exist only during the build (for example Coolify variables limited to build time) have no effect, and no secret ends up inside the image. Each server setting accepts the `NUXT_` name shown or the short name in brackets; if both are set, the `NUXT_` name wins. The startup log line `Auth mode` shows the mode in effect and which variable set it.

A private site without a JWT secret refuses to start rather than run unprotected. Any `AUTH_MODE` value other than `public` (including typos) is treated as private.

| Variable | Default | Description |
|----------|---------|-------------|
| `NUXT_PUBLIC_SITE_NAME` | `f0` | Site name (header, OG, RSS) |
| `NUXT_PUBLIC_SITE_DESCRIPTION` | `Documentation` | Default meta description |
| `NUXT_PUBLIC_SITE_URL` | — | Base URL for sitemap, canonical links, OG |
| `NUXT_CONTENT_DIR` (`CONTENT_DIR`) | `./content` | Path to content directory |
| `NUXT_PRIVATE_DIR` (`PRIVATE_DIR`) | `./private` | Path to the directory holding `allowlist.json` |
| `NUXT_AUTH_MODE` (`AUTH_MODE`) | `public` | `public` or `private` |
| `NUXT_F0_MODE` (`F0_MODE`) | `docs` | `blog` applies blog defaults to the site root |
| `NUXT_JWT_SECRET` (`JWT_SECRET`) | — | Secret for signing sessions, 32+ random characters (required in private mode) |
| `NUXT_AWS_REGION` (`AWS_REGION`) | `us-east-1` | AWS region for SES |
| `NUXT_AWS_ACCESS_KEY_ID` (`AWS_ACCESS_KEY_ID`) | — | AWS credentials for email |
| `NUXT_AWS_SECRET_ACCESS_KEY` (`AWS_SECRET_ACCESS_KEY`) | — | AWS credentials for email |
| `NUXT_EMAIL_FROM` (`EMAIL_FROM`) | — | Sender email address |
| `NUXT_GITHUB_WEBHOOK_SECRET` (`GITHUB_WEBHOOK_SECRET`) | — | Secret for webhook signature verification |
| `NUXT_PUBLIC_EDIT_URL` (`F0_EDIT_URL`) | — | Adds "Edit this page" to docs pages. A URL with `{path}` for the file's path in the content folder, e.g. `https://github.com/acme/docs/edit/main/content/{path}` |
| `NUXT_PUBLIC_RUM` | `false` | `true` logs each visitor's Core Web Vitals (LCP, INP, CLS, FCP, TTFB) as `{"msg":"rum",...}` lines. No cookies or third parties; the library loads after the page |
| `NUXT_PUBLIC_RUM_SAMPLE` | `1` | Share of page loads that report (0 to 1) |
| `NUXT_DRAFTS` (`F0_DRAFTS`) | `unlisted` | `unlisted`: drafts are reachable by URL (marked noindex) but listed nowhere. `404`: drafts are not served at all |
| `NUXT_F0_FLAGS` (`F0_FLAGS`) | — | One-release opt-outs from behavior changes, e.g. `-hide-drafts,-nested-config`. Logged at startup |
| `NUXT_IMAGE_CACHE_DIR` (`F0_IMAGE_CACHE_DIR`) | system temp dir | Where resized image variants are stored. Point it at a volume to keep variants across deploys |

---

## Theming

f0 supports automatic dark/light mode with manual toggle.

### Via `_brand.md` (Recommended)

Set `accent_color` in your `_brand.md` frontmatter. f0 derives the accent, tint and hover shades for light and dark mode, nudging the accent where needed so links stay readable (4.5:1 contrast) on each background; set `accent_exact: true` to use the color exactly as written. Add `custom_css` for full style control: it loads after the theme, so its rules win ties.

### Via CSS

Edit `assets/css/main.css` or provide a custom CSS file:

```css
:root {
  --color-accent: #2563eb;
  --color-bg-primary: #ffffff;
  --color-text-primary: #1a1a1a;
}

[data-theme="dark"] {
  --color-accent: #3b82f6;
  --color-bg-primary: #191919;
  --color-text-primary: #ececec;
}
```

---

## Architecture Constraints

f0 operates under 13 inviolable constraints that prevent feature creep and ensure architectural integrity:

| ID | Constraint |
|----|-----------|
| C-ARCH-FILESYSTEM-SOT-001 | The filesystem must remain the single source of truth |
| C-ARCH-NAV-CANONICAL-002 | Navigation derived exclusively from nav.md and file hierarchy |
| C-AI-TRIBRID-CONSISTENCY-003 | UI, SEO, and LLM renderings from the same source files |
| C-AI-LLMS-NO-UI-NOISE-004 | `/llms.txt` excludes all UI chrome |
| C-SEC-PRIVATE-NOT-PUBLIC-005 | `/private` never accessible via public URLs |
| C-SEC-OTP-ALLOWLIST-ONLY-006 | Auth only succeeds for allowlisted emails |
| C-OPS-ZERO-CONFIG-DEFAULT-008 | Functions without configuration beyond directory presence |
| C-PERF-CACHE-MTIME-010 | Cache invalidation uses mtime, never TTL |
| C-BRAND-CONTENT-ONLY-011 | All branding expressible through content files and env vars |
| C-MEDIA-PROGRESSIVE-012 | Image processing fails gracefully to originals |
| C-OPS-FAIL-FAST-013 | Fatal misconfigurations detected at startup |

---

## Roadmap

- [x] Filesystem-based content management
- [x] Tri-brid rendering (UI/SEO/LLM)
- [x] Dark/light theme toggle
- [x] OpenAPI/Swagger rendering
- [x] Private mode with OTP auth
- [x] Content caching with mtime invalidation
- [x] Health and readiness probes
- [x] Error resilience (per-file error boundaries)
- [x] `/llms.txt` pre-computation and section filtering
- [x] Navigation cache (mtime-based)
- [x] White-label branding (`_brand.md`)
- [x] Image processing pipeline (sharp, responsive images)
- [x] Structured JSON logging
- [x] Auto-generated sitemap.xml
- [x] OpenGraph and Twitter Card meta
- [x] Request timing (Server-Timing headers)
- [x] Startup validation and cache pre-warming
- [x] Embed system (Loom, Figma, Gist, Mermaid)
- [x] Asset validation
- [x] Content validation CLI
- [x] Blog engine with RSS, Atom and JSON feeds (full content)
- [x] Blog presets (`classic`, `cards`, `minimal`) and `--blog-*` design tokens
- [x] Webhook for CI/CD content sync
- [x] Site search with prefix matching and typo tolerance
- [x] Docs breadcrumbs, previous/next links and "Edit this page"
- [x] Tabs, steps and cards components; Markdown partials
- [x] Markdown at every page URL (`/page.md`)
- [x] Runtime-only settings, fail-closed private mode, engine image on GHCR
- [x] Accessibility (axe) and JavaScript budget checks in CI
- [x] Content census for each release (`npm run census -- ./content`)
- [ ] Versioned documentation
- [ ] Multi-language support

---

## License

MIT

---

Built with [Nuxt 4](https://nuxt.com).
