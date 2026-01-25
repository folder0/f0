# f0 Content Guide

This guide explains how to write and organize documentation content in f0.

## Content Directory Structure

All documentation lives in the `/content` directory:

```
content/
├── nav.md                    # Top navigation
├── home.md                   # Landing page
├── assets/
│   └── images/              # Images and media
├── guides/
│   ├── 01-getting-started.md
│   ├── 02-configuration.md
│   └── authentication/
│       ├── overview.md
│       └── setup.md
└── api/
    └── openapi.json         # API specification
```

## Navigation

### Top Navigation (`nav.md`)

Define top-level tabs in `content/nav.md`:

```markdown
- [Home](/)
- [Guides](/guides)
- [API Reference](/api)
- [GitHub](https://github.com/your-org/repo)
```

External links (starting with `http`) open in a new tab.

### Sidebar Navigation

The sidebar is **automatically generated** from the filesystem:

- Folders become collapsible groups
- Files become links
- Order is determined by numeric prefixes or frontmatter

## Markdown Files

### Frontmatter

Every markdown file can have YAML frontmatter:

```markdown
---
title: Page Title
description: SEO description (used in meta tags)
order: 1
draft: false
---

# Content starts here
```

| Field | Required | Description |
|-------|----------|-------------|
| `title` | No | Page title (defaults to first H1) |
| `description` | No | Meta description for SEO |
| `order` | No | Sort order (lower = first) |
| `draft` | No | If true, page is hidden |

### Ordering Content

Files are sorted by:

1. **Frontmatter `order`** — Highest priority
2. **Filename prefix** — Numbers like `01-`, `02-`
3. **Alphabetical** — By title

Examples:
```
01-introduction.md   → Order: 1
02-setup.md          → Order: 2
advanced-topics.md   → Order: 999 (default)
```

## Markdown Syntax

f0 supports **GitHub Flavored Markdown** plus custom extensions.

### Basic Formatting

```markdown
**Bold text**
*Italic text*
~~Strikethrough~~
`inline code`
[Link text](https://example.com)
```

### Headings

```markdown
# H1 - Page Title (one per page)
## H2 - Major Sections (shown in TOC)
### H3 - Subsections (shown in TOC)
#### H4 - Minor headings
```

**Best Practice:** Use H2 for main sections, H3 for subsections. These appear in the right-side Table of Contents.

### Code Blocks

````markdown
```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
}
```
````

Supported languages: JavaScript, TypeScript, Python, Bash, JSON, YAML, SQL, and many more.

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

## Custom Syntax

### Callout Boxes

Use callouts to highlight important information:

```markdown
:::info
This is an informational callout.
:::

:::warning
This is a warning callout.
:::

:::error
This is an error/danger callout.
:::

:::success
This is a success callout.
:::
```

### YouTube Embeds

Embed YouTube videos:

```markdown
::youtube[Video Title]{id=dQw4w9WgXcQ}
```

Replace `dQw4w9WgXcQ` with the actual video ID.

## Images

### Adding Images

1. Place images in `content/assets/images/`
2. Reference with relative or absolute paths

```markdown
<!-- Relative path -->
![Alt text](./assets/images/diagram.png)

<!-- Absolute path -->
![Alt text](/assets/images/logo.svg)
```

### Image Best Practices

- Use descriptive alt text for accessibility
- Optimize images before uploading (compress, resize)
- Prefer SVG for diagrams and icons
- Use PNG for screenshots, JPG for photos

## API Documentation

### OpenAPI Specifications

Drop an OpenAPI 3.x or Swagger 2.0 JSON file in your content:

```
content/
└── api/
    └── openapi.json
```

f0 automatically renders it as interactive documentation.

### Postman Collections

Postman Collection v2.x files are also supported:

```
content/
└── api/
    └── collection.json
```

## LLM Output (`/llms.txt`)

f0 generates a special `/llms.txt` endpoint for AI agents:

- All content concatenated into one file
- Plain text (no HTML, CSS, or UI elements)
- Structured with path headers and separators
- Images converted to `[Image: alt-text]`
- Videos converted to `[Video: title - URL]`

This allows AI agents to quickly understand your entire documentation.

## Writing Tips

### Be Concise

- Lead with the most important information
- Use short paragraphs (3-4 sentences max)
- Break up long content with headings

### Use Examples

```markdown
## Installation

Install the package:

```bash
npm install my-package
```

Then import it:

```javascript
import { something } from 'my-package';
```
```

### Link Generously

- Link to related pages within your docs
- Link to external resources when helpful
- Use descriptive link text (not "click here")

### Consider Your Audiences

Remember f0 serves three audiences:

1. **Humans** — Need clear, well-formatted content
2. **Search Engines** — Need good headings, descriptions, semantic HTML
3. **AI Agents** — Need structured, context-dense content

## Content Lifecycle

### Adding New Content

1. Create a `.md` file in the appropriate directory
2. Add frontmatter (at minimum, a title)
3. Write your content
4. Verify it appears in navigation

### Updating Content

1. Edit the markdown file
2. Changes appear immediately in development
3. In production, trigger a rebuild or webhook

### Removing Content

1. Delete the markdown file
2. Remove any navigation links
3. Consider adding redirects for important URLs

## Troubleshooting

### Page Not Appearing in Navigation

- Check file is in `/content` directory
- Verify filename ends in `.md`
- Check frontmatter YAML is valid
- Ensure `draft: true` is not set

### Broken Images

- Verify image exists in `content/assets/images/`
- Check path is correct (case-sensitive!)
- Ensure file extension matches actual format

### Formatting Issues

- Validate YAML frontmatter syntax
- Check for unclosed code blocks
- Verify callout syntax (three colons)

### Content Not Updating

- Restart development server
- Clear browser cache
- Check for syntax errors in the file
