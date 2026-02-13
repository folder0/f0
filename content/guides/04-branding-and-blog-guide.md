# f0 Branding & Blog Setup Guide

> A practical, step-by-step guide for white-labeling an f0 documentation site and adding a blog — without touching a single line of code.

---

## Part 1: Branding Your f0 Instance

f0 was designed for white-label deployment from day one. One Docker image serves unlimited branded sites — the only difference between them is the content volume. Every branding decision lives in two places: a `_brand.md` file in your content directory and a few environment variables.

### 1.1 — The Minimum Viable Brand

Create a file called `_brand.md` in the root of your content directory. This file uses frontmatter only — no body content.

```
content/
├── _brand.md          ← Create this
├── nav.md
├── home.md
└── guides/
```

The simplest useful brand sets just three things — a name, a color, and a footer:

```yaml
---
accent_color: "#0F172A"
footer_text: "© 2026 Acme Corp."
---
```

Set the site name via environment variable:

```bash
NUXT_PUBLIC_SITE_NAME="Acme Docs"
```

That's it. Your site now has a custom name in the header, your chosen accent color on all links and interactive elements, and a branded footer. No restart needed — f0 detects the file change automatically.

### 1.2 — Full Branding Configuration

Here's every field `_brand.md` supports:

```yaml
---
# Logo
logo: ./assets/images/logo.svg
logo_dark: ./assets/images/logo-dark.svg
favicon: ./assets/images/favicon.png

# Colors
accent_color: "#0F172A"

# Header
header_style: logo_and_text

# Footer
footer_text: "© 2026 Acme Corp. All rights reserved."
footer_links:
  - label: Privacy Policy
    url: /privacy
  - label: Terms of Service
    url: /terms
  - label: Status
    url: https://status.acme.com

# Style overrides
custom_css: ./assets/css/custom.css

# Social sharing
og_image: ./assets/images/og-default.png
---
```

Let's walk through each section.

### 1.3 — Logo Setup

f0 supports separate logos for light and dark mode. Place your logo files in `content/assets/images/`:

```
content/
├── _brand.md
└── assets/
    └── images/
        ├── logo.svg           ← Light mode logo
        ├── logo-dark.svg      ← Dark mode logo (optional)
        └── favicon.png        ← Browser tab icon
```

In `_brand.md`:

```yaml
---
logo: ./assets/images/logo.svg
logo_dark: ./assets/images/logo-dark.svg
favicon: ./assets/images/favicon.png
---
```

If `logo_dark` is omitted, the light mode logo is used in both themes.

**Logo format recommendations:**
- SVG for logos (scales perfectly, tiny file size)
- PNG for favicon (at least 32x32, ideally 180x180 for Apple touch)
- Keep logo height under 40px for the header — wider is fine, taller gets cropped

### 1.4 — Header Style

Three options control how the header displays your brand:

```yaml
header_style: text_only       # Just the site name text (default)
header_style: logo_only       # Just the logo image, no text
header_style: logo_and_text   # Logo image + site name text
```

The site name text comes from the `NUXT_PUBLIC_SITE_NAME` environment variable.

### 1.5 — Accent Color

The accent color cascades through the entire UI — links, active sidebar items, buttons, tag pills, callout borders, and focus rings:

```yaml
accent_color: "#0F172A"
```

Choose a color with sufficient contrast against both white and dark backgrounds. f0 uses this value directly in light mode and derives a slightly brighter variant for dark mode. Good starting points by industry:

| Industry | Color | Hex |
|----------|-------|-----|
| Tech/SaaS | Blue | `#2563eb` |
| Finance | Navy | `#0F172A` |
| Healthcare | Teal | `#0d9488` |
| Creative | Purple | `#7c3aed` |
| E-commerce | Green | `#059669` |

### 1.6 — Footer

The footer sits at the bottom of every page:

```yaml
footer_text: "© 2026 Acme Corp. All rights reserved."
footer_links:
  - label: Privacy Policy
    url: /privacy
  - label: Terms of Service
    url: /terms
  - label: Status
    url: https://status.acme.com
```

Footer links can point to internal pages (`/privacy`) or external URLs (`https://status.acme.com`). If you link to internal pages like `/privacy`, create the corresponding Markdown file at `content/privacy.md`.

Omit `footer_text` and `footer_links` entirely for no footer.

### 1.7 — Custom CSS Overrides

For styling beyond what accent color provides, create a custom CSS file:

```
content/
├── _brand.md
└── assets/
    └── css/
        └── custom.css
```

Reference it in `_brand.md`:

```yaml
custom_css: ./assets/css/custom.css
```

The custom CSS loads after f0's built-in styles, so your rules take precedence. You can override any CSS variable:

```css
/* content/assets/css/custom.css */

/* Override typography */
:root {
  --font-family-sans: 'Helvetica Neue', Helvetica, Arial, sans-serif;
}

/* Custom header background */
.header {
  background-color: #0F172A;
  border-bottom: none;
}

/* Wider content area */
:root {
  --content-max-width: 860px;
}

/* Custom callout styling */
.callout.callout-info {
  border-left-color: #0F172A;
  background-color: rgba(15, 23, 42, 0.05);
}

[data-theme="dark"] .callout.callout-info {
  background-color: rgba(15, 23, 42, 0.3);
}
```

**Key CSS variables you can override:**

| Variable | Default (Light) | Purpose |
|----------|----------------|---------|
| `--color-bg-primary` | `#ffffff` | Page background |
| `--color-text-primary` | `#1a1a1a` | Body text |
| `--color-accent` | `#2563eb` | Links, buttons, active states |
| `--font-family-sans` | `'Inter', sans-serif` | Body font |
| `--font-family-mono` | `'JetBrains Mono', monospace` | Code font |
| `--content-max-width` | `720px` | Content column width |
| `--sidebar-width` | `280px` | Left sidebar width |
| `--header-height` | `60px` | Top header height |

### 1.8 — Social Sharing (OpenGraph)

When someone shares a link to your docs on Slack, Twitter, or LinkedIn, the preview card uses OpenGraph metadata. Set a default image:

```yaml
og_image: ./assets/images/og-default.png
```

**Recommended OG image specs:**
- 1200 x 630 pixels
- PNG or JPEG
- Include your logo and site name on a branded background
- Keep text minimal — it renders small on mobile

Individual pages can override the default via their own frontmatter, and blog posts use `cover_image` as their OG image automatically.

### 1.9 — Environment Variables for Branding

These complement `_brand.md` and are set at deployment time:

```bash
# Required for proper branding
NUXT_PUBLIC_SITE_NAME="Acme Docs"
NUXT_PUBLIC_SITE_URL="https://docs.acme.com"
NUXT_PUBLIC_SITE_DESCRIPTION="Acme platform documentation"
```

`NUXT_PUBLIC_SITE_URL` is critical for production — it generates correct canonical URLs, sitemap entries, and absolute OG image URLs. Without it, social sharing previews will have broken images.

### 1.10 — Complete Branding Example

Here's a fully branded deployment for a fictional company:

**File structure:**

```
content/
├── _brand.md
├── nav.md
├── home.md
├── guides/
│   ├── 01-getting-started.md
│   └── 02-configuration.md
├── api/
│   └── openapi.json
├── privacy.md
├── terms.md
└── assets/
    ├── images/
    │   ├── logo.svg
    │   ├── logo-dark.svg
    │   ├── favicon.png
    │   └── og-default.png
    └── css/
        └── custom.css
```

**`_brand.md`:**

```yaml
---
logo: ./assets/images/logo.svg
logo_dark: ./assets/images/logo-dark.svg
favicon: ./assets/images/favicon.png
accent_color: "#6366f1"
header_style: logo_and_text
footer_text: "© 2026 Acme Corp. Built with f0."
footer_links:
  - label: Privacy
    url: /privacy
  - label: Terms
    url: /terms
  - label: GitHub
    url: https://github.com/acme/docs
custom_css: ./assets/css/custom.css
og_image: ./assets/images/og-default.png
---
```

**Docker run:**

```bash
docker run -p 3000:3000 \
  -v $(pwd)/content:/app/content \
  -e NUXT_PUBLIC_SITE_NAME="Acme Docs" \
  -e NUXT_PUBLIC_SITE_URL="https://docs.acme.com" \
  -e NUXT_PUBLIC_SITE_DESCRIPTION="Everything you need to build with Acme" \
  f0
```

---

## Part 2: Setting Up a Blog

f0's blog engine turns a directory of date-prefixed Markdown files into a full blog with index pages, tag filtering, RSS feed, and article-specific social meta — all without writing any code.

### 2.1 — Creating the Blog Directory

Create a `blog/` directory under `content/` and add a `_config.md` file that declares the blog layout:

```
content/
├── nav.md
├── home.md
├── guides/
└── blog/                    ← Create this directory
    └── _config.md           ← Create this file
```

**`content/blog/_config.md`:**

```yaml
---
layout: blog
title: Engineering Blog
description: Thoughts on building developer tools and documentation platforms
---
```

That single `layout: blog` declaration is what switches this directory from docs mode to blog mode. Everything else is automatic.

### 2.2 — Blog Configuration Options

The `_config.md` file supports these fields:

```yaml
---
layout: blog                          # Required — activates blog mode
title: Engineering Blog               # Blog index heading
description: Our engineering journal  # Subtitle on blog index + meta description
posts_per_page: 10                    # Posts per page (default: 10)
default_author: Acme Team             # Fallback author when post has no author field
date_format: long                     # "long" (February 11, 2026), "short" (Feb 11, 2026), "relative" (3 days ago)
---
```

### 2.3 — Adding to Navigation

Add the blog to your top navigation bar in `content/nav.md`:

```markdown
- [Home](/)
- [Guides](/guides)
- [API Reference](/api)
- [Blog](/blog)
```

The blog link now appears in the header. The sidebar automatically switches to a blog-specific sidebar (recent posts + tag cloud) when users navigate to the blog section.

### 2.4 — Writing Your First Post

Blog posts are standard Markdown files with date-prefixed filenames:

```
content/blog/
├── _config.md
└── 2026-02-12-hello-world.md     ← Your first post
```

**`content/blog/2026-02-12-hello-world.md`:**

```markdown
---
title: Hello World
description: Our first blog post — why we started this blog
date: 2026-02-12
author: Jane Doe
tags:
  - announcements
  - meta
excerpt: We're launching our engineering blog. Here's what to expect.
---

# Hello World

Welcome to our engineering blog. We'll be sharing insights on building
developer tools, documentation platforms, and the technical decisions
behind our products.

## What to Expect

We plan to cover topics like filesystem architecture, Markdown processing
pipelines, and the challenges of rendering content for three different
audiences simultaneously.

## Stay Tuned

Follow our RSS feed at `/feed.xml` or check back here regularly.
```

### 2.5 — Post Frontmatter Reference

Every blog post supports these frontmatter fields:

```yaml
---
# Required (recommended)
title: Post Title                    # Displayed as heading and in listings
date: 2026-02-12                     # Publication date (YYYY-MM-DD)

# Optional
description: SEO meta description    # Falls back to excerpt
author: Jane Doe                     # Byline (falls back to _config.md default_author)
tags:                                # Filtering and categorization
  - engineering
  - architecture
cover_image: ./assets/images/cover.png  # Hero image + OG image
excerpt: A short summary for cards.     # Blog index card text (auto-generated if missing)
pinned: false                        # true = always appears first
draft: false                         # true = hidden from blog index
---
```

**Date resolution priority:** If you omit the `date` frontmatter field, f0 extracts it from the filename. So `2026-02-12-hello-world.md` automatically gets `date: 2026-02-12`. If neither exists, it falls back to the file modification time.

**Excerpt auto-generation:** If you omit `excerpt`, f0 takes the first 160 characters of the post body (after stripping Markdown syntax) and appends `...`.

### 2.6 — File Naming Conventions

Blog posts sort by date (newest first), not by filename order. Two naming patterns work:

**Date-prefixed (recommended):**

```
blog/
├── 2026-02-12-hello-world.md         → URL: /blog/hello-world
├── 2026-02-10-architecture-deep-dive.md → URL: /blog/architecture-deep-dive
└── 2026-02-08-getting-started.md     → URL: /blog/getting-started
```

The date prefix is stripped from the URL slug. `2026-02-12-hello-world.md` renders at `/blog/hello-world`, not `/blog/2026-02-12-hello-world`.

**Without date prefix (use frontmatter date instead):**

```
blog/
├── hello-world.md                    → URL: /blog/hello-world (date from frontmatter)
└── architecture.md                   → URL: /blog/architecture
```

Both patterns work. Date-prefixed filenames are recommended because they sort naturally in file managers and Git diffs, and provide a fallback date without frontmatter.

### 2.7 — Tags and Filtering

Tags create a built-in filtering system. Add tags to post frontmatter:

```yaml
tags:
  - engineering
  - architecture
  - f0
```

Tags appear in three places:
- **Post card meta line** — inline text after the date
- **Blog sidebar** — tag cloud with post counts
- **Blog index** — filter bar when a tag is active

Users filter by tag by clicking a tag in the sidebar or by URL: `/blog?tag=engineering`.

### 2.8 — Pinned Posts

Pin important posts to the top of the blog index:

```yaml
---
title: Welcome to Our Blog
pinned: true
---
```

Pinned posts always appear first, before date-sorted posts. Their title renders slightly larger in the listing.

### 2.9 — Cover Images

Add a hero image to posts:

```yaml
cover_image: ./assets/images/my-post-cover.png
```

Place the image in your content assets directory:

```
content/
├── blog/
│   └── 2026-02-12-hello-world.md
└── assets/
    └── images/
        └── my-post-cover.png
```

The cover image is used for the post's OpenGraph image (social sharing preview) and displayed at the top of the post reading view. It's also available as a thumbnail in post cards if the blog layout supports it.

### 2.10 — Draft Posts

Hide work-in-progress posts from the blog index:

```yaml
draft: true
```

Draft posts don't appear in the blog listing, sidebar, RSS feed, or tag counts. They're still accessible by direct URL if you know the path — useful for sharing previews.

### 2.11 — RSS Feed

The blog automatically generates an RSS feed at `/feed.xml`. No configuration needed. The feed includes all published (non-draft) blog posts with titles, excerpts, dates, and links.

Readers can subscribe at `https://your-site.com/feed.xml`.

### 2.12 — Blog SEO

Each blog post automatically gets:

- `<title>` from frontmatter title
- `<meta name="description">` from description or excerpt
- `og:title`, `og:description`, `og:url` for social sharing
- `og:image` from cover_image (falls back to site default OG image)
- `article:published_time` from the post date
- `article:author` from the author field
- `article:tag` for each tag
- `twitter:card` set to `summary_large_image` when a cover image exists

The blog index page itself gets its own OG tags from the `_config.md` title and description.

### 2.13 — Complete Blog Example

Here's a fully set up blog with three posts:

**Directory structure:**

```
content/
├── _brand.md
├── nav.md
├── home.md
├── blog/
│   ├── _config.md
│   ├── 2026-02-12-launching-our-blog.md
│   ├── 2026-02-10-filesystem-architecture.md
│   └── 2026-02-08-why-zero-config.md
└── assets/
    └── images/
        ├── blog-cover-launch.png
        └── blog-cover-filesystem.png
```

**`content/blog/_config.md`:**

```yaml
---
layout: blog
title: Engineering Blog
description: Behind the scenes of building developer tools
default_author: Acme Engineering
date_format: long
posts_per_page: 10
---
```

**`content/blog/2026-02-12-launching-our-blog.md`:**

```markdown
---
title: Launching Our Engineering Blog
date: 2026-02-12
author: Jane Doe
tags:
  - announcements
cover_image: ./assets/images/blog-cover-launch.png
excerpt: We're starting an engineering blog to share our technical journey.
pinned: true
---

# Launching Our Engineering Blog

We're excited to launch this space where we'll share the technical
decisions, architecture patterns, and lessons learned while building
our platform.

## What We'll Cover

Expect posts on topics like filesystem-based CMS design, Markdown
processing pipelines, and deploying documentation platforms at scale.

## Subscribe

Grab our RSS feed at `/feed.xml` to stay updated.
```

**`content/blog/2026-02-10-filesystem-architecture.md`:**

```markdown
---
title: Why We Chose the Filesystem Over a Database
date: 2026-02-10
author: John Smith
tags:
  - architecture
  - engineering
cover_image: ./assets/images/blog-cover-filesystem.png
excerpt: We explored three approaches to content management and landed on the simplest one.
---

# Why We Chose the Filesystem Over a Database

When we started building our documentation platform, we evaluated three
approaches to content storage: a traditional database, a headless CMS,
and the raw filesystem.

## The Contenders

We considered PostgreSQL with a content editor, Strapi as a headless
CMS layer, and plain Markdown files on disk.

## The Decision

The filesystem won because it eliminated an entire category of complexity.
No migrations, no connection pooling, no ORM, no admin panel to maintain.
```

**`content/blog/2026-02-08-why-zero-config.md`:**

```markdown
---
title: Zero-Config Documentation
date: 2026-02-08
tags:
  - devex
  - engineering
excerpt: Drop Markdown into a folder and have a fully-functional documentation site.
---

# Zero-Config Documentation

The best developer experience is the one that gets out of your way.
We designed f0 so that you can go from an empty directory to a live
documentation site with a single command.
```

**`content/nav.md`:**

```markdown
- [Home](/)
- [Guides](/guides)
- [API Reference](/api)
- [Blog](/blog)
```

### 2.14 — Pure Blog Mode (No Docs)

If your entire site is a blog with no documentation sections, use the `F0_MODE` environment variable instead of creating a `_config.md`:

```bash
F0_MODE=blog
```

This treats the root `/content` directory as a blog. Drop Markdown files directly into `content/` — no subdirectory needed, no `_config.md` needed. The home page becomes the blog index.

`F0_MODE=blog` is a soft default — if any directory has its own `_config.md`, that takes precedence.

---

## Part 3: Branding + Blog Together

Here's how everything fits together for a fully branded site with both documentation and a blog.

### 3.1 — Combined File Structure

```
content/
├── _brand.md                        ← Branding config
├── nav.md                           ← Top navigation
├── home.md                          ← Landing page
│
├── guides/                          ← Documentation section
│   ├── 01-getting-started.md
│   ├── 02-configuration.md
│   └── 03-deployment.md
│
├── api/                             ← API reference section
│   └── openapi.json
│
├── blog/                            ← Blog section
│   ├── _config.md
│   ├── 2026-02-12-post-one.md
│   ├── 2026-02-10-post-two.md
│   └── 2026-02-08-post-three.md
│
├── privacy.md                       ← Footer-linked page
├── terms.md                         ← Footer-linked page
│
└── assets/
    ├── images/
    │   ├── logo.svg
    │   ├── logo-dark.svg
    │   ├── favicon.png
    │   ├── og-default.png
    │   └── blog-covers/
    │       ├── post-one.png
    │       └── post-two.png
    └── css/
        └── custom.css
```

### 3.2 — Deployment

```bash
docker run -p 3000:3000 \
  -v $(pwd)/content:/app/content \
  -e NUXT_PUBLIC_SITE_NAME="Acme Docs" \
  -e NUXT_PUBLIC_SITE_URL="https://docs.acme.com" \
  -e NUXT_PUBLIC_SITE_DESCRIPTION="Platform documentation and engineering blog" \
  f0
```

### 3.3 — What You Get

With this setup, your f0 instance serves:

| URL | What Renders |
|-----|-------------|
| `/` | Branded landing page from `home.md` |
| `/guides/getting-started` | Documentation page with sidebar nav |
| `/api` | Auto-rendered OpenAPI spec |
| `/blog` | Blog index with post cards, sidebar tags, pagination |
| `/blog/post-one` | Single blog post with reading view |
| `/blog?tag=engineering` | Blog filtered to one tag |
| `/privacy` | Static page linked from footer |
| `/feed.xml` | RSS feed of blog posts |
| `/llms.txt` | AI-optimized plain text of all content |
| `/sitemap.xml` | XML sitemap for search engines |

All pages carry your logo, accent color, footer, and OG image. Blog posts get their own social preview cards with cover images. The sidebar automatically switches between docs navigation and blog navigation depending on which section the reader is in.

### 3.4 — Validating Before Deploying

Run the content validation CLI to catch issues before going live:

```bash
npm run validate -- ./content
```

This checks frontmatter YAML validity, broken image references, heading hierarchy, missing titles, nav.md link targets, and duplicate URL slugs. Exit code 0 means you're clear to deploy.

---

## Appendix: Quick Reference

### _brand.md Fields

| Field | Type | Default | Example |
|-------|------|---------|---------|
| `logo` | string | — | `./assets/images/logo.svg` |
| `logo_dark` | string | Same as `logo` | `./assets/images/logo-dark.svg` |
| `favicon` | string | — | `./assets/images/favicon.png` |
| `accent_color` | string | `#2563eb` | `"#0F172A"` |
| `header_style` | string | `text_only` | `logo_and_text` |
| `footer_text` | string | — | `"© 2026 Acme Corp."` |
| `footer_links` | array | `[]` | `[{label: "Privacy", url: "/privacy"}]` |
| `custom_css` | string | — | `./assets/css/custom.css` |
| `og_image` | string | — | `./assets/images/og-default.png` |

### Blog _config.md Fields

| Field | Type | Default | Example |
|-------|------|---------|---------|
| `layout` | string | `docs` | `blog` (required) |
| `title` | string | `Blog` | `Engineering Blog` |
| `description` | string | — | `Behind the scenes` |
| `posts_per_page` | number | `10` | `15` |
| `default_author` | string | — | `Acme Team` |
| `date_format` | string | `long` | `short`, `relative` |

### Blog Post Frontmatter

| Field | Type | Default | Required |
|-------|------|---------|----------|
| `title` | string | First H1 / filename | Recommended |
| `date` | string | From filename / file mtime | Recommended |
| `author` | string | `default_author` | No |
| `tags` | array | `[]` | No |
| `cover_image` | string | — | No |
| `excerpt` | string | Auto (first 160 chars) | No |
| `pinned` | boolean | `false` | No |
| `draft` | boolean | `false` | No |
| `description` | string | Falls back to excerpt | No |

### Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `NUXT_PUBLIC_SITE_NAME` | Header text, OG title prefix | `Acme Docs` |
| `NUXT_PUBLIC_SITE_URL` | Canonical URLs, sitemap, OG | `https://docs.acme.com` |
| `NUXT_PUBLIC_SITE_DESCRIPTION` | Default meta description | `Platform documentation` |
| `F0_MODE` | `blog` for pure-blog sites | `blog` |
