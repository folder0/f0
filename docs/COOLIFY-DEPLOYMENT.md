# f0 Coolify Deployment Guide

How to run an f0 site on [Coolify](https://coolify.io) with the repository's Dockerfile. Each site is one Coolify application that builds from its own repository.

> **Read Step 5 before your first deploy.** Environment variables must use the `NUXT_` names shown there. A plain `AUTH_MODE=private` set in Coolify is ignored when the container starts, which leaves a "private" site public.

## Prerequisites

### Server requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| **RAM** | 1GB + 2GB swap | 2GB+ |
| **CPU** | 1 vCPU | 2 vCPU |
| **Storage** | 10GB | 20GB |

The image runs on Node.js 24 (pinned in the Dockerfile). You don't need Node.js on the server itself.

Building the app needs 1–2GB of memory. Servers with less than 1GB available will fail during the build unless they have swap.

---

## Step 1: Prepare the server

### 1.1 Check available memory

```bash
ssh user@your-server
free -h
```

### 1.2 Add swap (servers with less than 2GB RAM)

```bash
# Create a 2GB swap file
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Keep it after reboot
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

free -h
```

### 1.3 Keep the Docker build cache

Do **not** run `docker system prune -af` or `docker builder prune -af` before deploys. They delete the cached dependency install, so the next deploy rebuilds everything from scratch (several minutes instead of about one), and they delete the previous images Coolify needs to roll back.

In Coolify, under **Servers → your server → Advanced**:

- Turn **Force Docker Cleanup** off, or raise the cleanup threshold so it only runs when the disk is nearly full.
- Keep at least 2 previous images per application so rollback works.

If the disk really is full, remove only dangling images: `docker image prune -f`.

---

## Step 2: Configure the Coolify server

### 2.1 Concurrent builds

On small servers, set **Servers → your server → Advanced → Concurrent Builds** to `1`, so two builds don't compete for memory.

### 2.2 Build timeout

The default (3600 seconds) is enough. Don't set it below 1800 seconds.

---

## Step 3: Create the application

1. **Projects** → select or create a project → **+ New** → **Application**.
2. Choose your Git provider and repository.
3. Build settings:

| Setting | Value |
|---------|-------|
| **Build Pack** | Dockerfile |
| **Dockerfile Location** | `/Dockerfile` |
| **Port Exposes** | `3000` |
| **Port Mappings** | Leave empty |

---

## Step 4: Health check

The repository's Dockerfile defines a `HEALTHCHECK` that probes `/_ready` on `127.0.0.1:3000` every 10 seconds. For Dockerfile-based applications Coolify uses that healthcheck, so you don't need to configure one by hand.

Leave **Enable Healthcheck** on. If you set values in the dashboard, mirror the Dockerfile:

| Setting | Value | Why |
|---------|-------|-----|
| **Scheme** | `http` | The container serves plain HTTP; TLS ends at Coolify's proxy |
| **Host** | `127.0.0.1` | `localhost` can resolve to IPv6 inside Alpine and fail |
| **Port** | `3000` | Not 80 |
| **Path** | `/_ready` | `/` is a full page render, and a redirect in private mode |
| **Interval** | `10` | Seconds between checks |
| **Timeout** | `3` | |
| **Retries** | `6` | |
| **Start Period** | `10` (use `30` above ~500 pages) | |

`/_ready` answers 200 once the content directory is readable. `/_health` only says the process is alive. Both work without a login in private mode.

---

## Step 5: Environment variables

Use the `NUXT_` names below. f0 reads its configuration when the container starts only through these names. Short names such as `AUTH_MODE` or `JWT_SECRET` are read at build time and then frozen, so changing them later has no effect, and setting them only at runtime is ignored.

### 5.1 Public site

```env
NUXT_AUTH_MODE=public
NUXT_PUBLIC_SITE_NAME=Your Site Name
NUXT_PUBLIC_SITE_DESCRIPTION=One sentence about the site
NUXT_PUBLIC_SITE_URL=https://docs.example.com
```

`NUXT_PUBLIC_SITE_URL` is needed for canonical links, the sitemap and feed links. Without it they fall back to the request's host.

### 5.2 Private site (email login)

```env
NUXT_AUTH_MODE=private
NUXT_JWT_SECRET=<output of: openssl rand -base64 32>
NUXT_AWS_REGION=us-east-1
NUXT_AWS_ACCESS_KEY_ID=<key>
NUXT_AWS_SECRET_ACCESS_KEY=<secret>
NUXT_EMAIL_FROM=no-reply@example.com
```

Set all of these together. Switching to private mode without a real `NUXT_JWT_SECRET` and email settings locks everyone out.

In `private/allowlist.json`, list who may sign in, and list admins explicitly if anyone should use the admin API (content upload, audit logs). Without an `admins` list nobody is an admin:

```json
{
  "emails": ["alice@example.com"],
  "domains": ["example.com"],
  "admins": ["alice@example.com"]
}
```

### 5.3 Other variables

| Variable | When |
|----------|------|
| `GITHUB_WEBHOOK_SECRET` | Only if you use the GitHub webhook. Without it the webhook refuses every request. |
| `F0_MODE=blog` | Root of the site is a blog. |
| `NUXT_CONTENT_DIR`, `NUXT_PRIVATE_DIR` | Only if content or private files live somewhere other than `/app/content` and `/app/private`. |

### 5.4 Keep secrets out of the build

In Coolify, untick **Available at Buildtime** for `NUXT_JWT_SECRET`, `NUXT_AWS_ACCESS_KEY_ID` and `NUXT_AWS_SECRET_ACCESS_KEY`, and leave **Available at Runtime** ticked. Values available at build time can end up inside the built image, where anyone with access to the image can read them.

If a secret was ever available at build time, or was in a `.env` file during a build, rotate it.

---

## Step 6: Content

Pick **one** of these per site. Don't combine them: a volume mounted on `/app/content` hides the content baked into the image, so git pushes would silently stop changing the site.

### Option A: content in the repository

```
your-repo/
├── content/          ← committed
│   ├── nav.md
│   ├── home.md
│   └── guides/
├── private/
│   └── allowlist.json
└── ... app files
```

Push to the deployed branch and Coolify rebuilds and redeploys. Every content push rebuilds the image.

### Option B: content on a mounted directory

1. Add a **Directory Mount** for content: source `/data/coolify/applications/{app-id}/content`, destination `/app/content`.
2. Add one for private files: source `/data/coolify/applications/{app-id}/private`, destination `/app/private`.
3. Copy your content to the source directories on the server.

Edits to files in the mounted directory show up without a redeploy. The directories must be readable by the container user (uid 1001).

---

## Step 7: Deploy

Click **Deploy**.

### Typical timing

| Phase | Duration | Notes |
|-------|----------|-------|
| Clone | 10–30s | |
| Install dependencies | 1–5 min | Cached after the first deploy, as long as you don't prune |
| Build | 1–2 min | Longer on 1-vCPU servers with swap |
| Start and health check | 10–30s | |

If the Coolify UI shows **504 Gateway Timeout** during a build, the UI timed out but the build continues. Refresh after a few minutes, or check with `docker ps -a` on the server.

---

## Step 8: Verify

In Coolify the application should show **Running** and **Healthy**. Then check:

```bash
curl -s https://your-domain.com/_ready          # {"status":"ready",...}
curl -sI https://your-domain.com/ | head -1      # 200 (302 to /login in private mode)
curl -s https://your-domain.com/llms.txt | head  # public sites only
```

---

## CDN and Cloudflare

Public sites work well behind Cloudflare. f0 sends long cache lifetimes for `/_nuxt/*` and shorter ones for `/llms.txt`, the sitemap and feeds.

For **private** sites, f0 marks every response except `/_nuxt/*` as `Cache-Control: private, no-store`. Don't add cache rules that override this (for example "cache everything" on `/api/content/*` or `/llms.txt`): a shared cache would then serve signed-in content to anyone.

---

## Troubleshooting

### Build fails during "transforming..."

Out of memory. Add swap (Step 1.2) and set concurrent builds to 1 (Step 2.1).

### Container starts, then stops

Usually the health check. Check port `3000`, scheme `http`, host `127.0.0.1`, path `/_ready`. Then read the logs: `docker logs <container_id>`.

### "Custom healthcheck found in Dockerfile"

Coolify found the Dockerfile's `HEALTHCHECK` while the dashboard health check is disabled. Enable the dashboard health check (Step 4).

### npm install takes 10+ minutes

Swap thrashing on a small server. Add swap or RAM, and stop pruning the build cache so dependencies are only installed when `package-lock.json` changes.

### A private site is reachable without logging in

The mode was set with `AUTH_MODE` instead of `NUXT_AUTH_MODE` (Step 5). Set the `NUXT_` variables, redeploy, and check that `curl -sI https://your-domain.com/guides` answers with a redirect to `/login`.

---

## Don't build locally and commit `.output`

Earlier versions of this guide suggested building on your own machine and committing `.output/` when the server was too small to build. Don't. The build output contains every value from your local `.env` (including `JWT_SECRET` and AWS keys), and it contains native modules for your machine's platform, which break image processing on Linux. If that was done, remove `.output` from the repository history and rotate those secrets. If a server is too small to build, add swap or build the image somewhere else.

---

## Quick reference

```
BEFORE DEPLOY
  □ 1GB+ RAM, or swap added
  □ Concurrent builds: 1 on small servers
  □ Docker build cache kept (no prune before deploys)

HEALTH CHECK
  □ Enabled; http, 127.0.0.1, port 3000, path /_ready

ENVIRONMENT
  □ NUXT_AUTH_MODE (not AUTH_MODE)
  □ NUXT_PUBLIC_SITE_NAME, NUXT_PUBLIC_SITE_URL
  □ Private: NUXT_JWT_SECRET + NUXT_AWS_* + NUXT_EMAIL_FROM, all set together
  □ Secrets not available at build time

CONTENT
  □ One strategy: in the repo, OR a mounted directory

AFTER DEPLOY
  □ Running and Healthy
  □ /_ready answers 200
  □ Private sites redirect to /login when signed out
```

---

## Version history

| Date | Changes |
|------|---------|
| 2026-10-08 | Rewritten: NUXT_ variable names and secrets kept out of builds, /_ready health check, no cache pruning, one content strategy per site, CDN caveat for private sites, removed the pre-build-and-commit workaround |
| 2026-02-07 | Initial guide based on deployment troubleshooting |
