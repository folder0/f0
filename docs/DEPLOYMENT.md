# f0 Deployment Guide

This guide covers deploying f0 to production, with specific instructions for **Coolify** (self-hosted PaaS).

## Deployment Options

| Platform | Complexity | Cost | Best For |
|----------|------------|------|----------|
| **Coolify** | Low | Self-hosted | Teams with existing infrastructure |
| Docker Compose | Low | Self-hosted | Simple VPS deployments |
| Kubernetes | High | Variable | Enterprise scale |
| Vercel/Netlify | Low | Free tier | Static sites (no private mode) |

## Deploying to Coolify

### Prerequisites

- Coolify installed on your server
- GitHub repository with f0 code
- Domain name (optional but recommended)

### Step 1: Connect Repository

1. In Coolify dashboard, go to **Projects** → **New Project**
2. Select **GitHub** as source
3. Choose your f0 repository
4. Select the branch to deploy (usually `main`)

### Step 2: Configure Build Settings

| Setting | Value |
|---------|-------|
| Build Pack | Dockerfile |
| Dockerfile | `./Dockerfile` |
| Port | 3000 |

### Step 3: Set Environment Variables

In Coolify's **Environment Variables** section:

```env
# Required
AUTH_MODE=private
JWT_SECRET=<generate-secure-secret>

# AWS SES (for private mode)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
EMAIL_FROM=no-reply@yourdomain.com

# Site Configuration
NUXT_PUBLIC_SITE_NAME=My Documentation
NUXT_PUBLIC_SITE_DESCRIPTION=Documentation for our product

# Optional: Analytics
NUXT_PUBLIC_GTAG_ID=G-XXXXXXXXXX
```

**Generate JWT Secret:**
```bash
openssl rand -base64 32
```

### Step 4: Configure Persistent Volumes

**Critical:** Your documentation content needs to persist across deployments.

In Coolify's **Persistent Storage** section, add:

| Container Path | Description |
|----------------|-------------|
| `/app/content` | Documentation markdown files |
| `/app/private` | Allowlist and secure files |

### Step 5: Set Up Domain (Optional)

1. Go to **Domains** in your Coolify service
2. Add your domain (e.g., `docs.yourdomain.com`)
3. Enable **HTTPS** (Let's Encrypt)

### Step 6: Deploy

Click **Deploy** and wait for the build to complete.

## Updating Content

### Option A: Git-Based Updates (Recommended)

1. Push changes to your repository
2. Coolify automatically rebuilds and deploys
3. Content in persistent volumes remains unchanged

To update content:
- SSH into your server
- Edit files in the mounted volume
- Or use Coolify's file manager (if available)

### Option B: GitHub Webhook Sync

Set up automatic content sync from a separate content repository:

1. Create a webhook in your content repository
2. Point it to: `https://docs.yourdomain.com/api/webhook`
3. Set the secret in `GITHUB_WEBHOOK_SECRET`

### Option C: Admin Upload (Future)

The admin UI for uploading content is planned for a future release.

## Health Checks

f0 includes a built-in health check. Coolify will automatically use:

```
GET / (expects 200 OK)
```

## Scaling Considerations

### Single Instance (Default)

f0 uses in-memory storage for:
- OTP codes
- Rate limiting

This works perfectly for single-instance deployments.

### Multiple Instances

If you need horizontal scaling:

1. **Sticky Sessions:** Configure your load balancer to use sticky sessions
2. **Redis:** Replace in-memory storage with Redis (modify `server/utils/storage.ts`)
3. **Shared Storage:** Ensure content volumes are accessible by all instances

## Security Checklist

- [ ] `JWT_SECRET` is unique and secure (32+ characters)
- [ ] AWS credentials have minimal required permissions
- [ ] `private/allowlist.json` contains only authorized emails
- [ ] HTTPS is enabled
- [ ] Environment variables are not exposed in logs

## Monitoring

### Logs

In Coolify, view logs via:
- Dashboard → Your Service → Logs
- Or: `docker logs <container-id>`

### Metrics to Watch

- Response times (should be <200ms for cached content)
- Memory usage (typically <256MB)
- Error rate (check for 500s)

## Backup Strategy

### What to Back Up

1. **Content directory** (`/app/content`)
   - Your markdown files
   - API specifications
   - Images and assets

2. **Private directory** (`/app/private`)
   - `allowlist.json`

3. **Environment variables**
   - Export from Coolify periodically

### Backup Commands

```bash
# On your server
docker cp <container>:/app/content ./backup/content
docker cp <container>:/app/private ./backup/private
```

## Troubleshooting

### Deployment Fails

1. Check Coolify build logs
2. Verify Dockerfile syntax
3. Ensure all environment variables are set

### Content Not Showing

1. Check volume mounts are correct
2. Verify `nav.md` exists in content directory
3. Check server logs for parsing errors

### Authentication Errors

1. Verify AWS SES credentials
2. Check email is in allowlist
3. Ensure `AUTH_MODE=private` is set
4. Test SES from AWS console

### SSL Certificate Issues

1. Verify domain DNS points to Coolify server
2. Check Let's Encrypt rate limits
3. Try manual certificate upload

## Rollback Procedure

In Coolify:
1. Go to **Deployments**
2. Find the previous working deployment
3. Click **Rollback**

Or manually:
```bash
docker tag f0:current f0:backup
docker pull f0:previous
docker-compose up -d
```

## Performance Optimization

### Caching

f0 caches:
- Parsed markdown (in memory)
- Navigation structure (in memory)

Cache is invalidated on:
- Server restart
- Webhook trigger
- Admin upload

### CDN (Optional)

For high-traffic sites, add a CDN:

1. Set up Cloudflare or similar
2. Point DNS to CDN
3. Configure cache rules:
   - `/_nuxt/*` → Cache 1 year
   - `/api/content/*` → Cache 1 hour
   - `/llms.txt` → Cache 1 hour

## Support

If you encounter issues:

1. Check the [troubleshooting section](#troubleshooting)
2. Review Coolify documentation
3. Open an issue on GitHub
