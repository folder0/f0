# f0 (Folder Zero)

> The "Folder 0" Documentation Platform.  
> A filesystem-based documentation engine that renders a single source of truth for **Humans** (UI), **Search Engines** (SEO), and **AI Agents** (LLM Context).

---

## The Philosophy: Zero Config. Tri-Brid Output.

Documentation tools have become too complex. f0 strips away the database, the admin dashboard, and the configuration files.

**The Filesystem is the CMS.**

If you can write Markdown and organize folders, you can deploy f0.

### The Tri-Brid Engine

f0 takes your raw Markdown and renders it simultaneously in three modes:

- **Human Mode**: A beautiful, "Notion-like" Vue.js interface (Pico.css).
- **SEO Mode**: Server-Side Rendered (SSR) HTML for crawlers.
- **Agent Mode**: A stripped, context-dense stream at `/llms.txt` for AI coding agents (Cursor, Copilot).

---

## ⚡ Quick Start

```bash
# 1. Clone f0
git clone https://github.com/your-org/f0.git
cd f0

# 2. Install dependencies
npm install

# 3. Run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You are done.

### Alternative: Download Release

```bash
# 1. Download and extract the latest release
unzip f0.zip
cd f0

# 2. Install dependencies
npm install

# 3. Run the development server
npm run dev
```

---

## 📂 The "Folder 0" Structure

There is no database. Your folder structure *is* the site structure.

```
/f0-root
├── content/
│   ├── nav.md                # ← The Top Navigation Bar (Just a list)
│   ├── home.md               # ← The Landing Page
│   │
│   ├── briefs/               # ← Tab: "Briefs"
│   │   ├── 01-intro.md
│   │   └── 02-concept.md
│   │
│   ├── guides/               # ← Tab: "Guides"
│   │   └── setup/
│   │       └── install.md    # ← Renders at /guides/setup/install
│   │
│   ├── api/                  # ← Tab: "API"
│   │   └── v1-users.json     # ← Auto-rendered OpenAPI/Swagger
│   │
│   └── assets/               # ← Images and static files
│       └── images/
│
├── private/                  # ← SECURE ZONE (Requires OTP)
│   ├── allowlist.json        # ← Auth Access Control
│   └── internal-doc.md
│
└── nuxt.config.ts            # ← The only config file
```

### Navigation (`nav.md`)

Define your top navigation bar with a simple Markdown list:

```markdown
- [Home](/)
- [Guides](/guides)
- [API Reference](/api)
- [External Link](https://example.com)
```

### Ordering Files

Prefix filenames with numbers to control sidebar order:

```
guides/
├── 01-getting-started.md    # ← Appears first
├── 02-configuration.md      # ← Appears second
└── 03-deployment.md         # ← Appears third
```

The numeric prefix is stripped from URLs: `01-getting-started.md` → `/guides/getting-started`

### Callouts

Use fenced callout syntax for highlighted information:

```markdown
:::info

This is an informational callout.

:::

:::warning

This is a warning callout.

:::

:::error

This is an error callout.

:::

:::success

This is a success callout.

:::
```

---

## 🤖 AI-First Documentation (`/llms.txt`)

f0 treats AI agents as first-class citizens. We do not force LLMs to scrape HTML.

Access [http://localhost:3000/llms.txt](http://localhost:3000/llms.txt) to see what the AI sees:

- **Stripped**: No CSS, no navbars, no footers.
- **Contextualized**: Header injection (`Path: Guides > Setup`) ensures the LLM understands hierarchy.
- **Dense**: Optimized for context-window efficiency.

### Example Output

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

## 🔐 Private Mode (Lite-Auth)

Secure internal documentation without an Identity Provider.

### Setup

1. Set environment variable:
   ```bash
   AUTH_MODE=private
   ```

2. Add authorized emails to `/private/allowlist.json`:
   ```json
   {
     "emails": [
       "alice@company.com",
       "bob@company.com"
     ]
   }
   ```

3. Configure email delivery (AWS SES):
   ```bash
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your-key
   AWS_SECRET_ACCESS_KEY=your-secret
   EMAIL_FROM=no-reply@yourdomain.com
   ```

### How It Works

1. User requests a private route
2. f0 challenges for email address
3. 8-digit OTP sent via email
4. OTP verified → JWT issued → Access granted

---

## 🚀 Deployment

### Docker (Recommended)

```bash
# Build the image
docker build -t f0 .

# Run the container
docker run -p 3000:3000 \
  -v $(pwd)/content:/app/content \
  -e AUTH_MODE=public \
  f0
```

### Docker Compose

```bash
docker-compose up -d
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_MODE` | `public` | `public` or `private` |
| `JWT_SECRET` | (required in private mode) | Secret for signing tokens |
| `CONTENT_DIR` | `./content` | Path to content directory |
| `AWS_REGION` | `us-east-1` | AWS region for SES |
| `AWS_ACCESS_KEY_ID` | - | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | - | AWS credentials |
| `EMAIL_FROM` | - | Sender email address |
| `NUXT_PUBLIC_SITE_NAME` | `f0` | Site name in header |

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview

# Or start with Node
node .output/server/index.mjs
```

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/navigation` | GET | Returns navigation structure |
| `/api/content/[...slug]` | GET | Returns rendered content |
| `/llms.txt` | GET | AI-optimized content stream |
| `/api/auth/request-otp` | POST | Request OTP (private mode) |
| `/api/auth/verify-otp` | POST | Verify OTP (private mode) |

---

## 🎨 Theming

f0 supports automatic dark/light mode based on system preference, with manual toggle.

### Customization

Edit `assets/css/main.css` to customize:

```css
:root {
  /* Light mode colors */
  --color-accent: #2563eb;
  --color-bg-primary: #ffffff;
  --color-text-primary: #1a1a1a;
}

[data-theme="dark"] {
  /* Dark mode colors */
  --color-accent: #3b82f6;
  --color-bg-primary: #191919;
  --color-text-primary: #ececec;
}
```

---

## 📜 Semantic Authority (Architecture Constraints)

This YAML block is the immutable constitution of the f0 project. It defines the constraints that prevent feature creep and ensure architectural integrity.

```yaml
system: f0
version: 1.0.0
status: active
mode: strict

goal:
  primary: >
    Provide a low-friction documentation system where a single filesystem-based
    source of truth renders consistently for humans, search engines, and AI agents.

constraints:
  - id: C-ARCH-FILESYSTEM-SOT-001
    description: "The filesystem must remain the single source of truth."
    enforcement: block
    rationale: "Configuration-free operation depends on eliminating secondary databases."

  - id: C-ARCH-NAV-CANONICAL-002
    description: "Navigation structure must be derived exclusively from nav.md and file hierarchy."
    enforcement: block
    rationale: "Predictable navigation is required for humans and LLMs to share the same mental model."

  - id: C-AI-TRIBRID-CONSISTENCY-003
    description: "UI, SEO, and LLM renderings must originate from the same source files."
    enforcement: block
    rationale: "Divergent render paths create contradictory meaning for humans vs agents."

  - id: C-AI-LLMS-NO-UI-NOISE-004
    description: "The /llms.txt output must exclude all UI, styling, and navigation chrome."
    enforcement: block
    rationale: "LLM ingestion must be context-dense and free of presentation artifacts."

  - id: C-SEC-PRIVATE-NOT-PUBLIC-005
    description: "Files under /private must never be directly accessible via public URLs."
    enforcement: block
    rationale: "Internal configuration constitutes sensitive access-control data."

  - id: C-SEC-OTP-ALLOWLIST-ONLY-006
    description: "Authentication must only succeed for emails present in allowlist.json."
    enforcement: block
    rationale: "Private mode relies on explicit access approval, not open registration."

  - id: C-OPS-ZERO-CONFIG-DEFAULT-008
    description: "f0 must function without any required configuration beyond directory presence."
    enforcement: block
    rationale: "Adoption depends on minimizing setup friction."
```

---

## 🗺️ Roadmap

- [x] Filesystem-based content management
- [x] Tri-brid rendering (UI/SEO/LLM)
- [x] Dark/light theme toggle
- [x] OpenAPI/Swagger rendering
- [x] Private mode with OTP auth
- [ ] Full-text search
- [ ] Versioned documentation
- [ ] Multi-language support
- [ ] Webhook for CI/CD content sync

---

## 📄 License

MIT

---

Built with [Nuxt 3](https://nuxt.com) and [Pico.css](https://picocss.com).
