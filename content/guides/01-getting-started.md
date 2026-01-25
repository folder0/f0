---
title: Getting Started
description: Learn how to set up and use f0 for your documentation
order: 1
---

# Getting Started

Welcome to f0! This guide will walk you through setting up your first documentation site.

## Prerequisites

Before you begin, make sure you have:

- Node.js 20 or later
- A text editor (VS Code recommended)
- Basic familiarity with Markdown

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/litedocs.git
cd litedocs
npm install
```

Copy the example environment file:

```bash
cp .env.example .env
```

## Configuration

Edit your `.env` file to configure f0:

```env
# Authentication mode
AUTH_MODE=public

# Site metadata
NUXT_PUBLIC_SITE_NAME=My Docs
NUXT_PUBLIC_SITE_DESCRIPTION=Documentation for My Project
```

## Adding Content

Create markdown files in the `/content` directory:

```
content/
├── nav.md           # Top navigation links
├── home.md          # Landing page content
├── guides/
│   ├── 01-intro.md  # Numbered for ordering
│   └── 02-setup.md
└── api/
    └── openapi.json # API specification
```

### Frontmatter

Each markdown file can have YAML frontmatter:

```markdown
---
title: My Page Title
description: Page description for SEO
order: 1
---

# Content starts here
```

## Running Locally

Start the development server:

```bash
npm run dev
```

Visit `http://localhost:3000` to see your docs.

## Next Steps

- Learn about [Authentication](/guides/authentication/overview)
- Explore the [API Reference](/api)
- Set up [deployment](/guides/deployment)

:::success
Congratulations! You've set up your first f0 site.
:::
