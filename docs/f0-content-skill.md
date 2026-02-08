# SKILL.md — f0 Content Authoring

> This skill teaches Claude how to create, structure, and manage content for **f0**, a filesystem-based documentation platform built on Nuxt.js. f0 renders one source file three ways: Visual UI (Vue), SEO (SSR HTML), and AI/LLM context (`/llms.txt`).

---

## Core Principle: The Filesystem IS the CMS

There is no database. No admin panel for content. The directory structure under `/content` defines the entire site. Every file you create, rename, or move changes the live documentation. Navigation, hierarchy, and routing are all derived from the filesystem.

---

## Directory Structure

```
/content/                    ← The entire documentation site
├── nav.md                   ← Top navigation bar (required)
├── home.md                  ← Landing page (renders at /)
│
├── briefs/                  ← Tab: "Briefs"
│   ├── 01-intro.md
│   └── 02-concept.md
│
├── guides/                  ← Tab: "Guides"
│   └── setup/
│       └── install.md       ← Renders at /guides/setup/install
│
├── api/                     ← Tab: "API"
│   └── v1-users.json        ← Auto-rendered OpenAPI/Swagger spec
│
└── assets/
    └── images/              ← Content images
        └── diagram.png
```

### Key Rules

1. **Top-level folders** under `/content` become navigation tabs (linked via `nav.md`).
2. **Nested folders** create sidebar groups that are collapsible.
3. **Files** become pages. The filename (minus extension and numeric prefix) becomes the URL slug.
4. **`/private`** directory is the secure zone — never publicly accessible via URL.
5. **`nav.md`** is the single source of truth for the top navigation bar.

---

## File Types

### Markdown (`.md`) — Primary Content

All documentation pages are standard Markdown files with optional YAML frontmatter.

### JSON (`.json`) — API Specifications

OpenAPI/Swagger specs or Postman Collections placed in the `/api` directory are auto-rendered into browsable API documentation.

---

## nav.md — Top Navigation Configuration

The `nav.md` file controls the top navigation bar. It uses a simple Markdown list of links.

```markdown
- [Briefs](/briefs)
- [Guides](/guides)
- [API](/api)
```

### Rules

- Each list item is a `- [Label](/path)` link.
- The path must correspond to a top-level folder under `/content`.
- Order in the file determines order in the navigation bar.
- This is the ONLY way to define top-level navigation. There is no config file or setting.

---

## Frontmatter

Every Markdown file supports optional YAML frontmatter at the top of the file, delimited by `---`.

```yaml
---
title: Getting Started
description: Learn how to set up f0 in under 5 minutes
order: 1
draft: false
---
```

### Supported Fields

| Field         | Type    | Required | Default              | Purpose                                      |
|---------------|---------|----------|----------------------|----------------------------------------------|
| `title`       | string  | No       | First H1 in content  | Page title (browser tab, sidebar, SEO)       |
| `description` | string  | No       | —                    | Meta description for SEO `<meta>` tags       |
| `order`       | number  | No       | 999                  | Sort position within its directory            |
| `draft`       | boolean | No       | false                | If `true`, page is hidden from navigation    |

### Title Resolution Order

1. Frontmatter `title` field (highest priority)
2. First `# H1` heading in the document body
3. Filename transformed to title case (fallback)

---

## Content Ordering

Files within a directory are sorted by the following priority:

1. **Frontmatter `order` value** — Lowest number appears first.
2. **Filename numeric prefix** — Files starting with `01-`, `02-`, etc.
3. **Alphabetical by title** — Final fallback.

### Example

```
content/guides/
├── 01-introduction.md      → Appears first (prefix: 01)
├── 02-setup.md             → Appears second (prefix: 02)
├── advanced-topics.md      → Appears last (no prefix, order: 999)
```

You can also use frontmatter to override filename ordering:

```yaml
---
title: Advanced Topics
order: 0
---
```

This would push "Advanced Topics" to the very top regardless of filename.

---

## Markdown Syntax Reference

f0 supports **GitHub Flavored Markdown (GFM)** plus custom extensions.

### Standard GFM

```markdown
**Bold text**
*Italic text*
~~Strikethrough~~
`inline code`
[Link text](https://example.com)
![Image alt text](./assets/images/photo.png)
```

### Headings

```markdown
# H1 — Page Title (use exactly ONE per page)
## H2 — Major Section (appears in right-side TOC)
### H3 — Subsection (appears in right-side TOC)
#### H4 — Minor heading (does NOT appear in TOC)
```

**Best Practice:** Structure every page with a single H1, then H2s for major sections, and H3s for subsections. The right-side Table of Contents is auto-generated from H2 and H3 headings only.

### Code Blocks

````markdown
```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
}
```
````

Supported languages include: JavaScript, TypeScript, Python, Bash, JSON, YAML, SQL, HTML, CSS, and many more. Syntax highlighting is handled by `rehype-highlight`.

Every code block automatically gets a **copy button** in the rendered UI.

**Warning:** Avoid Unicode box-drawing characters (┌─│└→) inside code blocks — they can cause the syntax highlighter to fail. Use ASCII alternatives instead.

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
```

### Task Lists

```markdown
- [x] Completed task
- [ ] Pending task
- [ ] Another task
```

### Blockquotes

```markdown
> This is a blockquote.
> It can span multiple lines.
```

---

## Custom Syntax Extensions

### Callout Boxes

Use triple-colon (`:::`) fenced blocks for callout boxes:

```markdown
:::info
This is an informational callout. Use for tips and general notes.
:::

:::warning
This is a warning callout. Use for cautions and important notices.
:::

:::error
This is an error/danger callout. Use for critical warnings and breaking changes.
:::

:::success
This is a success callout. Use for confirmations and positive outcomes.
:::
```

Callout blocks support full Markdown inside them — paragraphs, code, links, lists, etc.

### YouTube Embeds

```markdown
::youtube[Video Title]{id=dQw4w9WgXcQ}
```

Replace the `id` value with the actual YouTube video ID. The video will be rendered as a responsive embed in the UI and converted to `[Video: Title - URL]` in the `/llms.txt` output.

### API Endpoint Blocks

Document API endpoints with method-colored badges:

```markdown
:::api GET /users/{id}
Get user by ID

Retrieves a specific user by their unique identifier.
:::

:::api POST /users
Create user

Creates a new user account with the provided information.
:::

:::api DELETE /users/{id}
Delete user

Permanently removes a user account.
:::
```

Supported HTTP methods and their badge colors:

| Method    | Color  |
|-----------|--------|
| `GET`     | Green  |
| `POST`    | Blue   |
| `PUT`     | Orange |
| `PATCH`   | Purple |
| `DELETE`  | Red    |
| `OPTIONS` | Gray   |
| `HEAD`    | Gray   |

Full Markdown is supported inside API blocks, including code examples, tables, and parameter lists.

---

## Images

### Placement

Store images in `content/assets/images/` (or any subfolder under `content/`).

### Usage

```markdown
<!-- Relative path from current file -->
![Architecture Diagram](./assets/images/architecture.png)

<!-- Absolute path from content root -->
![Logo](/assets/images/logo.png)
```

### LLM Behavior

Images are converted to `[Image: alt-text]` in the `/llms.txt` output, so always provide descriptive alt text.

---

## Content for Tri-Brid Rendering

Every piece of content you write is consumed three ways. Author with all three in mind:

### 1. Visual UI (Vue/HTML)

- Markdown is rendered to HTML via the remark/rehype pipeline.
- Code blocks get syntax highlighting and copy buttons.
- Callouts render as styled boxes. API blocks get colored method badges.
- H2/H3 headings populate the right-side Table of Contents.

### 2. SEO (SSR HTML)

- Nuxt server-side renders every page as full HTML for crawlers.
- Frontmatter `title` becomes `<title>` and `<h1>`.
- Frontmatter `description` becomes `<meta name="description">`.
- Heading hierarchy (H1 → H2 → H3) signals content structure to search engines.

### 3. AI/LLM Context (`/llms.txt`)

- All content is concatenated into a single plain-text stream.
- CSS, navbars, footers, and interactive elements are stripped.
- File paths are injected as context headers so the LLM understands hierarchy.
- Images become `[Image: alt-text]`, videos become `[Video: title - URL]`.

**Example `/llms.txt` output:**

```
================================================================================
PATH: /guides/getting-started
TITLE: Getting Started
================================================================================

# Getting Started

Welcome to the documentation. This guide will help you...

================================================================================
PATH: /api/users
TITLE: Users API
================================================================================

# Users API

The Users API provides endpoints for managing user accounts...
```

---

## Writing Best Practices

### Structure

- **One H1 per page.** Use it as the page title or rely on frontmatter `title`.
- **Use H2 for major sections** — these become TOC entries and LLM section markers.
- **Use H3 for subsections** — these also appear in the TOC.
- **Keep pages focused.** One concept per page. Link between pages for cross-references.

### Naming

- **Filenames become URLs.** Use lowercase, hyphen-separated names: `getting-started.md` → `/getting-started`.
- **Folder names become URL segments.** `guides/auth/setup.md` → `/guides/auth/setup`.
- **Numeric prefixes control order** but are stripped from URLs: `01-intro.md` → `/intro`.

### Content Quality for AI

- Write clear, self-contained sections. LLMs read the `/llms.txt` stream without visual context.
- Use descriptive alt text on images — it's the only thing AI agents see.
- Avoid relying on visual formatting (colors, layout) to convey meaning.
- Use explicit language: "see the section below" is meaningless to an LLM — use "see the Authentication Setup section" instead.

### API Documentation

- Use `:::api` blocks for inline endpoint documentation.
- For full OpenAPI/Swagger specs, drop `.json` files in the `/api` directory.
- Include request/response examples as JSON code blocks inside API blocks.
- Document error responses in a table format for clarity.

---

## Agent APIs (For Programmatic Access)

f0 exposes APIs for AI agents and retrieval systems:

### Semantic Search

```
GET /api/agents/search?q=query&limit=5&include_content=true
```

Parameters: `q` (required), `limit` (1-20, default 5), `include_content` (boolean), `section` (filter by nav section).

### Raw Markdown Download

```
GET /api/content/raw/{path}
```

Returns the raw Markdown source of any page. Supports `?download=true` for file download. Response headers include `X-Page-Title`, `X-Page-Path`, and `X-Word-Count`.

### Full LLM Context

```
GET /llms.txt
```

Returns all public documentation concatenated as plain text, optimized for LLM ingestion.

---

## Common Mistakes to Avoid

| Mistake | Why It Breaks | Fix |
|---------|---------------|-----|
| No `nav.md` file | Top navigation bar is empty | Create `content/nav.md` with list links |
| Multiple H1 headings | Confuses TOC and SEO | Use exactly one H1 per page |
| Unicode art in code blocks | Crashes syntax highlighter | Use ASCII characters only |
| Images without alt text | LLM output shows `[Image: ]` | Always write descriptive alt text |
| Files in `/private` directory | Publicly accessible via URL | Use the `/private` root directory (outside `/content`) |
| Spaces in filenames | Broken URLs | Use hyphens: `my-page.md` |
| Missing frontmatter `---` delimiters | Frontmatter rendered as content | Ensure opening AND closing `---` |

---

## Template: New Documentation Page

```markdown
---
title: Your Page Title
description: A brief description for SEO and previews
order: 1
---

# Your Page Title

Introduction paragraph explaining what this page covers.

## Prerequisites

What the reader needs before starting.

## Step 1: First Thing

Explanation of the first step.

\`\`\`bash
# Example command
npm install something
\`\`\`

## Step 2: Second Thing

Explanation of the second step.

:::info
Helpful tip related to this step.
:::

## Next Steps

Links to related pages and follow-up content.
```

---

## Template: API Documentation Page

```markdown
---
title: Users API
description: API reference for user management endpoints
order: 2
---

# Users API

The Users API provides endpoints for managing user accounts.

## Endpoints

:::api GET /users
List all users

Returns a paginated list of all users.
:::

:::api GET /users/{id}
Get user by ID

Retrieves a specific user by their unique identifier.
:::

:::api POST /users
Create user

Creates a new user account.
:::

\`\`\`json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "role": "admin"
}
\`\`\`

## Error Responses

| Status | Description |
|--------|-------------|
| 400 | Bad Request — Invalid parameters |
| 401 | Unauthorized — Missing or invalid token |
| 404 | Not Found — User doesn't exist |

## Rate Limiting

:::warning
API requests are rate-limited to 100 requests per minute per API key.
:::
```
