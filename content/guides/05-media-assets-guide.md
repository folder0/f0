# f0 Media Assets Guide

> How to use images, logos, diagrams, and other media in f0 — across documentation sites, blogs, and internal wikis.

---

## How Assets Work in f0

Every media file lives inside the `content/assets/` directory. When you reference an image in Markdown, f0 does three things automatically: resolves the path to a server API URL, wraps the image in a responsive `<picture>` element with WebP variants at multiple sizes, and validates that the file actually exists on disk. If the file is missing, the page still renders — you get a broken image icon and a structured log warning, never a crash.

There is no upload interface. No media library. No CDN configuration. You put files in a folder, reference them in Markdown, and f0 handles the rest. This applies identically whether you're running a public documentation site, a blog, or a private internal wiki.

---

## Part 1: The Assets Directory

### 1.1 — Structure

All media lives under `content/assets/`. You can organize it however you want:

```
content/
└── assets/
    ├── images/                     ← Recommended: all images here
    │   ├── logo.svg
    │   ├── architecture-diagram.png
    │   ├── screenshot-dashboard.png
    │   └── blog-covers/            ← Subdirectories are fine
    │       ├── post-one-cover.png
    │       └── post-two-cover.png
    ├── css/
    │   └── custom.css              ← Custom style overrides
    └── downloads/                  ← Any static files
        └── api-collection.json
```

There's no required structure inside `assets/`. Flat, nested, thematic — whatever makes sense for your project. The only rule is that it lives under `content/assets/`.

### 1.2 — Supported Formats

| Format | Processed | Responsive | Notes |
|--------|-----------|-----------|-------|
| PNG | Yes | Yes | Best for screenshots, diagrams with text |
| JPEG / JPG | Yes | Yes | Best for photographs |
| WebP | Yes | Yes | Modern format, smaller than PNG/JPEG |
| AVIF | Yes | Yes | Newest format, smallest files |
| SVG | No | No | Served as-is (already scalable), gets lazy loading |
| GIF | No | No | Served as-is (animated), gets lazy loading |
| ICO | No | No | Favicons only |

"Processed" means sharp can resize and convert the image. "Responsive" means f0 generates a `<picture>` element with multiple sizes. SVGs and GIFs skip the processing pipeline entirely — they're served directly with `loading="lazy"` added.

### 1.3 — The Processing Pipeline

When a browser requests an image, the following happens:

```
Browser requests: /api/content/assets/images/diagram.png?w=800&f=webp

1. Asset endpoint receives the request
2. Resolves path to content/assets/images/diagram.png on disk
3. Checks disk cache: content/.cache/images/diagram-w800.webp
   → Cache exists AND source mtime hasn't changed → serve cache (fast)
   → Cache miss or stale → continue to step 4
4. Read original file from disk
5. sharp processes: resize to 800px wide, convert to WebP, quality 80
6. Write result to disk cache for next time
7. Return processed image with correct Content-Type header

If sharp fails at any point → serve the original file unchanged
```

The disk cache lives at `content/.cache/images/`. Add `.cache/` to your `.gitignore` — it's regenerated automatically.

### 1.4 — URL Parameters for On-Demand Processing

You can request specific image variants via URL query parameters:

```
/api/content/assets/images/photo.png              → Original file
/api/content/assets/images/photo.png?w=800        → 800px wide
/api/content/assets/images/photo.png?w=400&f=webp → 400px wide, WebP format
/api/content/assets/images/photo.png?w=1200&q=90  → 1200px wide, quality 90
/api/content/assets/images/photo.png?f=avif        → AVIF format, original size
```

| Parameter | Values | Default | Purpose |
|-----------|--------|---------|---------|
| `w` | 1–3840 | Original | Target width in pixels |
| `h` | 1–2160 | Original | Target height in pixels |
| `f` | `webp`, `avif`, `jpeg`, `png` | Original format | Output format |
| `q` | 1–100 | 80 | Compression quality |

Images are never upscaled. If you request `w=3000` on an 800px image, you get the original 800px.

You don't need to use these parameters directly in your Markdown — the pipeline adds them automatically. But they're useful for custom CSS backgrounds, OpenGraph images, or API integrations.

---

## Part 2: Using Images in Markdown

### 2.1 — Basic Syntax

Standard Markdown image syntax works everywhere:

```markdown
![Architecture diagram showing the request flow](./assets/images/architecture.png)
```

The path `./assets/images/architecture.png` is relative to the content root. This exact path also works when previewing the Markdown file in GitHub, VS Code, or any standard Markdown viewer — f0 was designed for path portability.

### 2.2 — What Happens Automatically

When you write `![alt text](./assets/images/photo.png)`, f0's Markdown pipeline transforms it into:

```html
<picture>
  <source
    srcset="/api/content/assets/images/photo.png?w=400&f=webp 400w,
            /api/content/assets/images/photo.png?w=800&f=webp 800w,
            /api/content/assets/images/photo.png?w=1200&f=webp 1200w"
    type="image/webp">
  <img
    src="/api/content/assets/images/photo.png?w=800"
    alt="alt text"
    loading="lazy"
    decoding="async">
</picture>
```

This gives you WebP at three breakpoints (400, 800, 1200px) with a fallback to the resized original at 800px — all with lazy loading. The browser picks the most appropriate size based on viewport and device pixel ratio.

### 2.3 — Path Formats

Several path formats are supported. All resolve to the same file:

```markdown
<!-- Relative from content root (recommended) -->
![Diagram](./assets/images/diagram.png)

<!-- Without leading ./ -->
![Diagram](assets/images/diagram.png)

<!-- Absolute from content root -->
![Diagram](/assets/images/diagram.png)
```

The recommended format is `./assets/images/filename.png` because it previews correctly in GitHub and VS Code while also working in f0.

### 2.4 — Alt Text Matters

Alt text serves three audiences in f0:

| Audience | What They See |
|----------|-------------|
| **Visual UI** | Tooltip on hover, fallback text if image fails |
| **SEO** | Image context for search engine crawlers |
| **AI/LLM** | `[Image: alt-text]` in `/llms.txt` — the *only* thing AI agents see |

Always write descriptive alt text. "Screenshot" is useless. "Dashboard showing monthly revenue trend with a 23% increase in Q4" is useful.

```markdown
<!-- Bad -->
![screenshot](./assets/images/dashboard.png)

<!-- Good -->
![Dashboard showing monthly revenue with 23% Q4 increase](./assets/images/dashboard.png)
```

### 2.5 — External Images

External URLs are passed through unchanged — no processing, no responsive wrapping:

```markdown
![External badge](https://img.shields.io/badge/status-active-green)
```

Use external URLs for badges, CDN-hosted content, or third-party images. For anything you control, put it in `content/assets/` so it benefits from processing and validation.

---

## Part 3: Assets in Documentation Sites

A documentation site typically uses images for diagrams, screenshots, code examples, and logos.

### 3.1 — Recommended Organization

```
content/
├── guides/
│   ├── 01-getting-started.md
│   ├── 02-configuration.md
│   └── 03-deployment.md
├── api/
│   └── openapi.json
└── assets/
    └── images/
        ├── getting-started/         ← Group by section
        │   ├── install-step-1.png
        │   ├── install-step-2.png
        │   └── dashboard-overview.png
        ├── configuration/
        │   └── settings-panel.png
        ├── deployment/
        │   ├── docker-architecture.png
        │   └── coolify-dashboard.png
        └── diagrams/                ← Or by type
            ├── system-overview.svg
            └── auth-flow.svg
```

Organize by section or by type — either works. The key is consistency so authors know where to find and add images.

### 3.2 — Diagrams

SVGs are ideal for architectural diagrams, flowcharts, and anything with text. They scale perfectly, remain sharp on retina displays, and are tiny files. f0 serves them directly with lazy loading — no processing needed.

```markdown
![System architecture with three-layer rendering pipeline](./assets/images/diagrams/system-overview.svg)
```

For diagrams you want to create inline, use Mermaid:

```markdown
::mermaid
graph LR
  A[Content Dir] --> B{Markdown Pipeline}
  B --> C[HTML for UI]
  B --> D[SSR for SEO]
  B --> E[Plain Text for LLM]
::
```

Mermaid diagrams are preserved as source code in `/llms.txt`, so AI agents can understand the structure without seeing the rendered image.

### 3.3 — Screenshots

For product screenshots and UI captures:

```markdown
![The configuration panel showing SMTP settings](./assets/images/configuration/smtp-settings.png)
```

Screenshot tips for documentation:
- Crop tightly to the relevant area — full-screen screenshots waste space
- Use PNG for UI with text (lossless, crisp text rendering)
- Aim for 1200–1600px wide originals — the pipeline will generate smaller variants
- Don't include sensitive data in screenshots (API keys, emails, passwords)

### 3.4 — Code Example Images

Sometimes a static code screenshot is better than a code block (e.g., showing IDE context, syntax highlighting with a specific theme, or terminal output with colors):

```markdown
![VS Code showing the directory structure with nav.md highlighted](./assets/images/getting-started/vscode-structure.png)
```

Prefer actual code blocks for anything a reader might want to copy. Use screenshots only when the visual context (IDE, terminal styling, surrounding UI) matters.

### 3.5 — Documentation Site Example

```markdown
---
title: Deployment Guide
description: Deploy f0 to production with Docker
order: 3
---

# Deployment Guide

This guide walks through deploying f0 to production.

## Architecture

The deployment architecture uses a three-stage Docker build:

![Three-stage Docker build: deps, builder, and runner stages](./assets/images/deployment/docker-architecture.svg)

## Step 1: Build the Image

Run the Docker build command from the project root:

` ` `bash
docker build -t f0 .
` ` `

## Step 2: Configure Volumes

Mount your content directory as a volume:

![Coolify dashboard showing volume configuration for /app/content](./assets/images/deployment/coolify-volumes.png)

:::info
The content volume persists across container restarts. Your documentation survives redeployments.
:::
```

---

## Part 4: Assets in Blog Posts

Blog posts use images for cover images (social sharing), inline illustrations, and author photos.

### 4.1 — Recommended Organization

```
content/
├── blog/
│   ├── _config.md
│   ├── 2026-02-12-announcing-v2.md
│   ├── 2026-02-10-architecture-deep-dive.md
│   └── 2026-02-08-getting-started.md
└── assets/
    └── images/
        ├── blog-covers/              ← Cover images for social sharing
        │   ├── announcing-v2.png
        │   ├── architecture.png
        │   └── getting-started.png
        ├── blog/                     ← Inline images per post
        │   ├── v2-dashboard-new.png
        │   ├── v2-dashboard-old.png
        │   └── architecture-layers.svg
        └── authors/                  ← Author headshots (optional)
            ├── jane-doe.jpg
            └── john-smith.jpg
```

### 4.2 — Cover Images

Cover images appear in three places: the blog post's hero area, the OpenGraph preview when shared on social media, and optionally as a thumbnail in post listing cards.

Set the cover image in frontmatter:

```yaml
---
title: Announcing Version 2.0
cover_image: ./assets/images/blog-covers/announcing-v2.png
---
```

**Cover image specifications:**
- Minimum 1200 x 630 pixels (OpenGraph requirement)
- 1200 x 630 is the standard OG aspect ratio (1.91:1) — design to this
- PNG or JPEG (not SVG — social platforms need raster images)
- Include your brand elements but keep text minimal — it renders small on mobile
- The image is automatically set as `og:image` for that post's social preview

If a post has no `cover_image`, the site-wide default from `_brand.md` `og_image` is used.

### 4.3 — Inline Blog Images

Use standard Markdown images inside blog posts:

```markdown
# Announcing Version 2.0

We completely redesigned the dashboard.

## Before and After

Here's what the old dashboard looked like:

![Previous dashboard with cluttered sidebar navigation](./assets/images/blog/v2-dashboard-old.png)

And here's the new version:

![New dashboard with clean sidebar and improved data visualization](./assets/images/blog/v2-dashboard-new.png)

The key changes were reducing visual noise and adding sparkline charts
to the overview panel.
```

All inline images get the same responsive treatment as documentation images — `<picture>` with WebP srcset at 400/800/1200px.

### 4.4 — Blog Post Example with Full Media

```markdown
---
title: Why We Chose the Filesystem Over a Database
date: 2026-02-10
author: Jane Doe
tags:
  - architecture
  - engineering
cover_image: ./assets/images/blog-covers/architecture.png
excerpt: We explored three approaches and landed on the simplest one.
---

# Why We Chose the Filesystem Over a Database

When we started building f0, we evaluated three content storage approaches.

## The Architecture

Our rendering pipeline takes a single source file and produces three outputs:

![Tri-brid rendering pipeline: Markdown source flowing to UI, SEO, and LLM outputs](./assets/images/blog/architecture-layers.svg)

## Performance Comparison

We benchmarked all three approaches on a 200-page documentation set:

![Bar chart comparing response times: filesystem 1ms, Redis 3ms, PostgreSQL 12ms](./assets/images/blog/benchmark-chart.png)

The filesystem approach was 12x faster than PostgreSQL for read operations,
which is all a documentation site needs.

:::info
The benchmark used mtime-based caching. Without caching, all three
approaches performed within 50ms — fast enough for production.
:::

## Mermaid Diagram

Here's the decision flow we used:

::mermaid
graph TD
  A[Content Storage?] --> B{Collaborative Editing?}
  B -->|Yes| C[Database CMS]
  B -->|No| D{Real-time Updates?}
  D -->|Yes| E[Redis + Files]
  D -->|No| F[Filesystem Only]
  F --> G[f0]
::
```

---

## Part 5: Assets in Internal Wikis (Private Mode)

An internal wiki runs f0 in private mode (`AUTH_MODE=private`) with email OTP authentication. Media assets work identically, but with access control and some additional considerations for sensitive content.

### 5.1 — Private Mode Setup

```bash
AUTH_MODE=private
JWT_SECRET=your-secret-key-here
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
EMAIL_FROM=wiki@company.com
```

Add authorized users to `private/allowlist.json`:

```json
{
  "emails": ["alice@company.com", "bob@company.com"],
  "domains": ["company.com"]
}
```

All content and assets are now behind authentication. Unauthenticated requests redirect to the login page.

### 5.2 — Recommended Organization for Wiki

Internal wikis tend to have more diverse content — team processes, onboarding docs, architecture decisions, meeting notes:

```
content/
├── nav.md
├── home.md
├── _brand.md
│
├── onboarding/
│   ├── 01-welcome.md
│   ├── 02-tools-setup.md
│   └── 03-first-week.md
│
├── engineering/
│   ├── architecture/
│   │   ├── overview.md
│   │   └── data-flow.md
│   ├── runbooks/
│   │   ├── deploy-production.md
│   │   └── incident-response.md
│   └── adrs/                       ← Architecture Decision Records
│       ├── 001-database-choice.md
│       └── 002-auth-strategy.md
│
├── design/
│   ├── brand-guidelines.md
│   └── component-library.md
│
├── blog/                           ← Internal engineering blog
│   ├── _config.md
│   └── 2026-02-12-q1-retrospective.md
│
└── assets/
    └── images/
        ├── branding/
        │   ├── company-logo.svg
        │   ├── company-logo-dark.svg
        │   └── brand-colors.png
        ├── onboarding/
        │   ├── slack-channels.png
        │   ├── github-access.png
        │   └── vpn-setup-step1.png
        ├── architecture/
        │   ├── system-overview.svg
        │   ├── data-flow.svg
        │   └── infrastructure.png
        ├── runbooks/
        │   ├── deploy-checklist.png
        │   └── grafana-dashboard.png
        └── design/
            ├── color-palette.png
            └── component-specs.png
```

### 5.3 — Sensitive Content Considerations

Assets behind auth are protected — unauthenticated users can't access them directly. But keep these practices in mind:

**Don't put secrets in images.** Screenshots of dashboards, config panels, or terminal output may contain API keys, passwords, or tokens. Redact before saving, or crop tightly to avoid capturing sensitive areas.

**Be careful with metadata.** JPEG and PNG files can contain EXIF data — GPS coordinates, camera info, timestamps, sometimes even thumbnail images of the uncropped original. Strip metadata before adding to the wiki:

```bash
# Strip EXIF from all images in a directory
# (requires exiftool or ImageMagick)
exiftool -all= ./content/assets/images/**/*.{jpg,png}

# Or with ImageMagick
mogrify -strip ./content/assets/images/**/*.{jpg,png}
```

**Internal screenshots age quickly.** UI changes, dashboards get redesigned, tools get replaced. Date your screenshots in the filename or put them in dated directories so stale images are easy to identify:

```
assets/images/runbooks/
├── grafana-dashboard-2026-02.png
└── grafana-dashboard-2026-01.png     ← Previous version, can delete
```

### 5.4 — Architecture Decision Records with Diagrams

ADRs (Architecture Decision Records) benefit heavily from diagrams. Combine Mermaid for flow diagrams with image files for system architecture:

```markdown
---
title: "ADR-002: Authentication Strategy"
description: Why we chose email OTP over SSO for documentation access
order: 2
---

# ADR-002: Authentication Strategy

## Status

Accepted — February 2026

## Context

We need to secure internal documentation access. Three options were evaluated.

## Decision Flow

::mermaid
graph TD
  A[Auth Requirement] --> B{User Base Size?}
  B -->|< 100| C[Email OTP]
  B -->|100-1000| D[SSO / SAML]
  B -->|> 1000| E[SSO + SCIM]
  C --> F[f0 Built-in Auth]
  D --> G[External IdP]
  E --> G
::

## Architecture

![Authentication flow: user enters email, OTP sent via SES, JWT issued on verification](./assets/images/architecture/auth-flow.svg)

## Consequences

Email OTP has zero external dependencies beyond AWS SES. The tradeoff
is manual allowlist management — acceptable for our team size of 30.
```

### 5.5 — Runbook Screenshots

Operations runbooks often need annotated screenshots showing exactly where to click or what to look for:

```markdown
---
title: Production Deployment Runbook
description: Step-by-step guide for deploying to production
---

# Production Deployment Runbook

## Pre-Deploy Checklist

Before starting, verify the Grafana dashboard shows normal metrics:

![Grafana dashboard — all panels should show green status indicators](./assets/images/runbooks/grafana-dashboard-2026-02.png)

:::warning
If any panel shows red or amber, **stop** and check the #incidents Slack channel
before proceeding with the deployment.
:::

## Step 1: Trigger the Build

Navigate to the Coolify dashboard and click "Deploy":

![Coolify deployment panel with the Deploy button highlighted](./assets/images/runbooks/coolify-deploy-button.png)
```

### 5.6 — Wiki with Docs + Blog Example

An internal wiki often combines documentation sections with an internal engineering blog:

```markdown
<!-- content/nav.md -->
- [Home](/)
- [Onboarding](/onboarding)
- [Engineering](/engineering)
- [Design](/design)
- [Blog](/blog)
```

```yaml
# content/blog/_config.md
---
layout: blog
title: Engineering Updates
description: Internal engineering blog — retrospectives, tech talks, and decisions
default_author: Engineering Team
---
```

```yaml
# content/_brand.md
---
logo: ./assets/images/branding/company-logo.svg
logo_dark: ./assets/images/branding/company-logo-dark.svg
favicon: ./assets/images/branding/favicon.png
accent_color: "#4f46e5"
header_style: logo_and_text
footer_text: "Internal — Company Confidential"
---
```

---

## Part 6: Asset Validation

### 6.1 — Automatic Runtime Validation

Every time f0 parses a Markdown file (on first request or after file change), it validates all image references. Missing images produce structured log warnings:

```json
{
  "level": "warn",
  "msg": "Missing image reference",
  "image": "./assets/images/old-diagram.png",
  "referencedIn": "/content/guides/setup.md",
  "resolvedTo": "/content/assets/images/old-diagram.png"
}
```

The page still renders — missing images appear as broken image icons, never as server errors.

### 6.2 — Pre-Deploy Validation

Run the CLI validator before deploying to catch broken references early:

```bash
npm run validate -- ./content
```

Output for image issues:

```
f0 Content Validation
==================================================

Scanning ./content...

✓ nav.md parsed successfully (5 sections)
✓ 23 markdown files found
✓ 18 images found

Warnings:
  ⚠ guides/setup.md:45: Image not found: ./assets/images/old-screenshot.png
  ⚠ blog/2026-02-10-post.md:12: Image not found: ./assets/images/blog/missing-cover.png

Summary: 23 files, 0 errors, 2 warnings (35ms)
```

Integrate into CI/CD to catch broken images before they reach production:

```yaml
# GitHub Actions
- name: Validate content
  run: npm run validate -- ./content
```

### 6.3 — Path Resolution Rules

The validator and runtime checker both resolve image paths the same way:

| Path Written | Resolves To |
|-------------|-------------|
| `./assets/images/x.png` | `content/assets/images/x.png` |
| `assets/images/x.png` | `content/assets/images/x.png` |
| `/assets/images/x.png` | `content/assets/images/x.png` |
| `../shared/x.png` | Relative to the Markdown file's directory |

The first three are all equivalent. The fourth allows referencing images outside the assets directory (relative to the file that references them) — useful for shared images across sections.

---

## Part 7: Tri-Brid Rendering of Media

Every image you add is consumed three ways. Author with all three in mind.

### Visual UI (Browsers)

Images are rendered as responsive `<picture>` elements with WebP srcset at 400, 800, and 1200px. Lazy loading is applied to all images. SVGs and GIFs are served directly.

### SEO (Search Engines)

Crawlers see the server-rendered `<img>` tag with:
- `alt` attribute from your Markdown
- `loading="lazy"` for performance signals
- The full `<picture>` element with `<source>` for WebP
- Cover images become `og:image` for social previews

### AI/LLM (`/llms.txt`)

Images are stripped and replaced with their alt text:

```
[Image: Dashboard showing monthly revenue with 23% Q4 increase]
```

This is why descriptive alt text matters — it's the only representation AI agents have of your visual content.

---

## Quick Reference

### Image Markdown Syntax

```markdown
![Descriptive alt text](./assets/images/filename.png)
```

### Processing URL Parameters

| Param | Values | Example |
|-------|--------|---------|
| `w` | 1–3840 | `?w=800` |
| `h` | 1–2160 | `?h=600` |
| `f` | `webp`, `avif`, `jpeg`, `png` | `?f=webp` |
| `q` | 1–100 | `?q=90` |

### File Format Guide

| Use Case | Format | Why |
|----------|--------|-----|
| Screenshots | PNG | Crisp text rendering |
| Photographs | JPEG | Smaller file sizes for photos |
| Diagrams | SVG | Infinite scalability, tiny files |
| Logos | SVG | Scales for header, OG, favicon |
| Blog covers | PNG or JPEG | Must be raster for OG images (1200x630) |
| Animated content | GIF | Only format with animation support |

### Organization by Deployment Type

| Deployment | Suggested Structure |
|------------|-------------------|
| **Documentation** | `assets/images/{section-name}/` — group by docs section |
| **Blog** | `assets/images/blog-covers/` + `assets/images/blog/` — covers separate from inline |
| **Internal Wiki** | `assets/images/{team-or-section}/` — group by team or knowledge area |

### Common Mistakes

| Mistake | What Happens | Fix |
|---------|-------------|-----|
| No alt text | LLM output shows `[Image: ]` | Always write descriptive alt text |
| Spaces in filename | Broken URLs | Use hyphens: `my-image.png` |
| SVG as cover_image | Broken social preview | Use PNG/JPEG for OG images |
| Image over 5MB | Slow page load | Resize before adding to content |
| Absolute system path | Broken in deployment | Use `./assets/images/` relative path |
| Missing `.cache/` in gitignore | Processed images in repo | Add `content/.cache/` to `.gitignore` |
| EXIF data in screenshots | Location/metadata leak (wiki) | Strip metadata before committing |
