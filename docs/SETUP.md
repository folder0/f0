# f0 Setup Guide

This guide walks you through setting up f0 for local development and production deployment.

## Prerequisites

- **Node.js 20+** — Required for running the application
- **npm** — Comes with Node.js
- **Git** — For version control
- **AWS Account** — Required only for private mode (email authentication)

## Quick Start (Public Mode)

The fastest way to get started with f0 in public mode:

```bash
# Clone the repository
git clone https://github.com/your-org/f0.git
cd f0

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Start development server
npm run dev
```

Visit `http://localhost:3000` to see your documentation site.

## Project Structure

```
f0/
├── content/              # 📚 YOUR DOCUMENTATION LIVES HERE
│   ├── nav.md           # Top navigation links
│   ├── home.md          # Landing page
│   ├── guides/          # Guide documents
│   └── api/             # API specifications
│
├── private/             # 🔒 SECURE FILES (never public)
│   └── allowlist.json   # Authorized emails
│
├── server/              # Server-side code
│   ├── api/             # API endpoints
│   ├── middleware/      # Request middleware
│   ├── routes/          # Custom routes (/llms.txt)
│   └── utils/           # Utility modules
│
├── components/          # Vue components
├── composables/         # Vue composables
├── pages/               # Page routes
├── layouts/             # Page layouts
├── assets/              # CSS and static assets
└── public/              # Public static files
```

## Environment Configuration

Copy `.env.example` to `.env` and configure:

### Required Settings

```env
# Authentication mode
AUTH_MODE=public          # 'public' or 'private'

# Site metadata
NUXT_PUBLIC_SITE_NAME=My Docs
NUXT_PUBLIC_SITE_DESCRIPTION=Documentation for my project
```

### Private Mode Settings (Required if AUTH_MODE=private)

```env
# JWT secret (generate with: openssl rand -base64 32)
JWT_SECRET=your-secure-random-secret

# AWS SES for email
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
EMAIL_FROM=no-reply@yourdomain.com
```

### Optional Settings

```env
# Google Analytics 4
NUXT_PUBLIC_GTAG_ID=G-XXXXXXXXXX

# GitHub webhook for auto-sync
GITHUB_WEBHOOK_SECRET=your-webhook-secret
```

## Setting Up Authentication (Private Mode)

### 1. Configure AWS SES

1. Go to AWS Console → SES
2. Verify your sending domain or email address
3. Create SMTP credentials or IAM user with SES permissions
4. If in SES sandbox, verify recipient emails too

### 2. Create Allowlist

Edit `private/allowlist.json`:

```json
{
  "emails": [
    "alice@company.com",
    "bob@company.com"
  ],
  "domains": [
    "@company.com"
  ]
}
```

### 3. Generate JWT Secret

```bash
openssl rand -base64 32
```

Copy the output to `JWT_SECRET` in your `.env` file.

### 4. Enable Private Mode

```env
AUTH_MODE=private
```

## Adding Content

### Markdown Files

Create `.md` files in the `content/` directory:

```markdown
---
title: My Page
description: Page description
order: 1
---

# My Page

Content goes here...
```

### Navigation

Edit `content/nav.md` for top-level navigation:

```markdown
- [Home](/)
- [Guides](/guides)
- [API](/api)
```

### API Specifications

Drop OpenAPI or Postman JSON files in your content directory:

```
content/
└── api/
    └── openapi.json    # Will render as API documentation
```

### File Ordering

Files are ordered by:
1. `order` field in frontmatter
2. Numeric prefix in filename (e.g., `01-intro.md`, `02-setup.md`)
3. Alphabetically by title

## Development Commands

```bash
# Start development server (hot reload)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type checking
npm run typecheck

# Linting
npm run lint
```

## Building for Production

```bash
# Build the application
npm run build

# The output is in .output/ directory
# Start with:
node .output/server/index.mjs
```

Or use Docker:

```bash
# Build image
docker build -t f0 .

# Run container
docker run -p 3000:3000 \
  -v ./content:/app/content \
  -v ./private:/app/private \
  -e AUTH_MODE=public \
  f0
```

## Troubleshooting

### "Module not found" errors

```bash
rm -rf node_modules .nuxt
npm install
```

### Port already in use

```bash
# Find process using port 3000
lsof -i :3000
# Kill it
kill -9 <PID>
```

### Authentication not working

1. Check `AUTH_MODE=private` is set
2. Verify AWS credentials are correct
3. Ensure email is in allowlist
4. Check SES is out of sandbox mode (or recipient is verified)

### Content not updating

1. Clear the cache: restart the dev server
2. Check file is in correct location
3. Verify frontmatter YAML is valid

## Next Steps

- Read the [Content Guide](./CONTENT-GUIDE.md) for writing documentation
- See [Deployment Guide](./DEPLOYMENT.md) for production deployment
- Check the sample content in `content/` for examples
