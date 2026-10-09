# f0 Deployment Guide

An overview of running f0 in production. For step-by-step Coolify instructions, see [COOLIFY-DEPLOYMENT.md](./COOLIFY-DEPLOYMENT.md).

## How f0 runs

f0 is a Node.js server built from this repository with the included Dockerfile. It reads Markdown from `/app/content` at runtime and, in private mode, the allowlist from `/app/private`. One container serves one site.

The Dockerfile has two targets:

| Target | Contents | Use |
|--------|----------|-----|
| `site` (default) | The app plus this repository's `content/` and `private/` | Building a site from its own repository, as Coolify does |
| `engine` | The app with empty `content/` and `private/` | One image shared by many sites, with content mounted or added on top |

Content is copied last, so changing only content reuses the cached app build: `docker build --target engine -t f0-engine .` once, then content changes cost seconds.

| Platform | Notes |
|----------|-------|
| **Coolify** | The documented path. See the Coolify guide. |
| Docker / Docker Compose | `docker compose up` with the included `docker-compose.yml` for local use. |
| Static hosts (Vercel, Netlify static) | Not supported. f0 needs a server for search, `/llms.txt`, image processing and private mode. |

## Configuration

Set configuration with the `NUXT_` environment variable names. Only those override f0's settings when the container starts; short names like `AUTH_MODE` are read once at build time and frozen.

```env
# Every site
NUXT_AUTH_MODE=public                       # or private
NUXT_PUBLIC_SITE_NAME=My Documentation
NUXT_PUBLIC_SITE_DESCRIPTION=Documentation for our product
NUXT_PUBLIC_SITE_URL=https://docs.example.com

# Private sites: set all of these together
NUXT_JWT_SECRET=<openssl rand -base64 32>
NUXT_AWS_REGION=us-east-1
NUXT_AWS_ACCESS_KEY_ID=<key>
NUXT_AWS_SECRET_ACCESS_KEY=<secret>
NUXT_EMAIL_FROM=no-reply@example.com

# Optional
GITHUB_WEBHOOK_SECRET=<secret>              # required if you use /api/webhook
F0_MODE=blog                                # root of the site is a blog
```

Keep secrets out of the build. On Coolify, untick **Available at Buildtime** for secrets. Values present at build time can be written into the built image.

## Content: choose one strategy

| Strategy | How content changes reach the site | Use when |
|----------|------------------------------------|----------|
| **In the repository** | Push; the platform rebuilds the image | Content is reviewed in git alongside the site |
| **Mounted directory** | Edit files on the server; changes show up without a redeploy | Content is edited on the server or synced by another tool |

Don't combine them. A volume mounted on `/app/content` hides the content inside the image, so git pushes stop having any effect.

### The GitHub webhook

`POST /api/webhook` verifies GitHub's signature and clears f0's in-memory caches. It does **not** fetch content. It is useful when another process updates a mounted content directory and you want changes to show up immediately. It refuses every request unless `GITHUB_WEBHOOK_SECRET` is set.

### Admin upload API

In private mode, users listed in `admins` in `private/allowlist.json` can upload Markdown, OpenAPI/Postman JSON and images through `POST /api/admin/upload`. Without an `admins` list nobody can. Uploads are written into the content directory, so they only persist on sites that use a mounted directory.

## Health checks

| Endpoint | Meaning |
|----------|---------|
| `/_health` | The process is alive |
| `/_ready` | The content directory is readable. Use this for load balancers and Coolify. |

Both answer without a login in private mode. The Dockerfile's `HEALTHCHECK` probes `/_ready`.

## Caching and CDNs

f0 caches parsed pages, navigation and `/llms.txt` in memory and refreshes them when files change. Caches start empty after a restart and warm up as pages are requested.

Behind a CDN such as Cloudflare:

- Public sites: `/_nuxt/*` can be cached for a year. Let f0's own `Cache-Control` headers govern everything else.
- Private sites: f0 sends `Cache-Control: private, no-store` on every response except `/_nuxt/*`. Don't add CDN rules that cache `/api/content/*`, `/llms.txt` or pages, or the CDN will serve signed-in content to anyone.

## Scaling

f0 is designed for one instance per site. These live in process memory and are not shared between instances:

- one-time login codes and rate limits
- revoked sessions (after logout)
- content caches

Running several instances needs sticky sessions at least, and revoked sessions would only be known to the instance that handled the logout.

## Security checklist

- [ ] `NUXT_AUTH_MODE=private` for private sites, and anonymous requests redirect to `/login`
- [ ] `NUXT_JWT_SECRET` is random, 32+ characters, and not available at build time
- [ ] No `.env` file or `.output/` directory was ever committed; if one was, rotate the secrets it held
- [ ] `private/allowlist.json` lists only the people who need access, and `admins` only those who need to upload
- [ ] AWS credentials only allow sending email through SES
- [ ] HTTPS is enabled
- [ ] No CDN rule caches content on private sites

## Backups

Back up the content and private directories (or the repository, if content lives in git), and your environment variables.

```bash
docker cp <container>:/app/content ./backup/content
docker cp <container>:/app/private ./backup/private
```

## Rollback

In Coolify, open **Deployments**, pick the last working deployment and choose **Rollback**. This needs previous images to still exist, so don't prune Docker images before deploying.

## Troubleshooting

### Content not showing

1. If you mount a content directory, check the mount path is `/app/content` and that the files are readable by uid 1001.
2. Check that `nav.md` exists in the content directory.
3. Look for parsing errors in the logs.

### Login emails don't arrive

1. Check `NUXT_AWS_*` and `NUXT_EMAIL_FROM` are set at runtime.
2. Check the address is in `private/allowlist.json`.
3. Confirm the sender address is verified in SES (and the recipient too, if SES is in sandbox mode).
