# Security Release Rollout (October 2026)

What to check and change on every f0 site when this release lands. Many sites are forks of this repository, so each fork needs the release merged in and the steps below done once.

Do steps 1 and 2 **now**, before merging anything. They fix exposure that already exists on running sites.

## 1. Check that private sites are actually private

Until this release, a site configured with `AUTH_MODE=private` only at runtime (for example in Coolify's environment, not during the build) was served **publicly**. Only the `NUXT_AUTH_MODE` name took effect at runtime.

To check every site on a Coolify server at once, run the read-only inventory with a short-lived read-only API token. It flags sites that are meant to be private but are public, secrets available at build time, and health checks on `/`. It never prints secret values.

```bash
COOLIFY_URL=https://coolify.example.com COOLIFY_TOKEN=<read-only token> npm run fleet -- --probe
```

Or check one site by hand. For each site that should be private:

```bash
curl -sI https://docs.example.com/guides | head -3
```

A private site answers `302` with `location: /login...`. If it answers `200`, it is public. Then:

1. In the site's environment, set all of these together: `NUXT_AUTH_MODE=private`, `NUXT_JWT_SECRET` (random, 32+ characters), `NUXT_AWS_REGION`, `NUXT_AWS_ACCESS_KEY_ID`, `NUXT_AWS_SECRET_ACCESS_KEY`, `NUXT_EMAIL_FROM`. Setting the mode without the secret and email settings locks everyone out.
2. Confirm `private/allowlist.json` is present in the deployed image or mount.
3. Redeploy, then check the `curl` above returns `302`, and sign in once to confirm email login works.
4. Treat the period the site was public as a data exposure: decide who needs to know, and check whether anything confidential was published.

## 2. Rotate secrets that may have leaked

Rotate `JWT_SECRET`, the AWS keys and `GITHUB_WEBHOOK_SECRET` for a site if **any** of these is true:

- A `.env` file or `.output/` directory was ever committed to its repository (`git log --all -- .env .output` shows commits).
- The secrets were marked **Available at Buildtime** in Coolify, or were present in the environment when the image was built. Build-time values are written into the server bundle inside the image.
- Images of the site were pushed to a registry other people can read.

Rotating `JWT_SECRET` signs everyone out. Shared AWS IAM users need one coordinated rotation across the sites that use them.

## 3. Merge the release into each fork

```bash
git remote add f0 <f0 repository URL>   # once
git fetch f0
git merge f0/master                     # or the release tag
npm install
npm test
npm run build && npm run test:contract
```

**If `git ls-files '.env*'` lists a committed `.env`, stop before deploying.** Docker builds no longer read it (see the `.env` row in section 4), so the site would come up with defaults, which means **public**. Move its settings into the site's environment first.

Expect conflicts where the fork changed the same files (for example `server/middleware/auth.ts`, `server/utils/markdown.ts`, `assets/css/main.css`). Keep the fork's intentional changes and this release's security changes. If a fork has engine improvements that every site would want, send them upstream to f0.

## 4. Behaviour that changes with this release

| Change | What you might notice | Action |
|--------|-----------------------|--------|
| Admin API needs an explicit `admins` list | Uploads and audit logs return 403 for everyone | Add `"admins": [...]` to `private/allowlist.json` for the people who upload |
| Logout ends the session on the server; removed users lose access on their next request | Copied tokens stop working after logout | None |
| Browser sessions use only the httpOnly cookie; the token is no longer kept in `localStorage` (old copies are deleted on the next visit) | None for readers. Fork code that read `localStorage.f0_token` or `getAuthHeader()` gets nothing back; same-origin requests already send the cookie | Drop any custom `Authorization` header in fork pages; use `GET /api/auth/session` for the signed-in user |
| Private mode no longer exempts files by extension | Images and other assets need a login on private sites | None (this was the leak) |
| Private-mode responses are `Cache-Control: private, no-store` | CDN stops caching private content | Remove any CDN rule that cached `/api/content/*`, `/llms.txt` or pages on private sites |
| `?path=` on `/api/blog`, `/api/blog/tags`, `/feed.xml` rejects `..` and hidden folders | Such requests return 400 | None |
| Numbered folders resolve by their URL name (`/reference` finds `02-reference/`), `.mdx` and `.markdown` pages resolve, and sitemap, search, `llms-index.txt` use the URLs the sidebar links to | Pages that returned 404 from sidebar or nav links now load; sitemap entries such as `/02-reference/x` and `/guides/index` become `/reference/x` and `/guides` | None. The old URLs keep working |
| Drafts (`draft: true`, `yes` or `on`) are left out of the sidebar, sitemap, `llms.txt`, `llms-index.txt` and search, not only blog listings. At their URL they show a Draft notice and send `noindex` | Draft pages vanish from navigation; `draft: yes` posts stop being published | Remove `draft` from pages that should be listed. To keep the old behavior for one release, set `F0_FLAGS=-hide-drafts`. `F0_DRAFTS=404` hides drafts completely |
| A page uses the nearest `_config.md` above it (nested and numbered folders included), not only its top-level folder's; root-level pages use the root `_config.md` and `F0_MODE=blog` | A nested `_config.md` that never took effect now does (e.g. `guides/changelog/` becomes a blog) | Check nested `_config.md` files still say what you want. `F0_FLAGS=-nested-config` restores the old rule for one release |
| `_config.md` edits apply on the next request in production (they needed a restart or webhook) | None | None |
| A webhook push or admin upload clears every content cache, including search, agent search, sitemap and `llms-index.txt` | New pages show up in search right after a push | None |
| `cover_image`, `hero_image` and `_brand.md` paths resolve like images in Markdown (relative to `content/assets`); absolute URLs pass through | The documented `cover_image: ./assets/images/cover.png` stops returning 404, and `og:image` becomes a working absolute URL (brand `og_image` is used when a page has none) | None |
| `/feed.xml` without `?path=` serves the site's blog; feed links use `NUXT_PUBLIC_SITE_URL` when set | The default feed stops being empty. If the site URL differs from the host the feed was fetched on, item GUIDs change once and readers may show posts again | Set `NUXT_PUBLIC_SITE_URL` to the public URL |
| Callouts (`:::info` ...) no longer swallow the blank line after them, and directive syntax inside code fences stays as written | Headings, images and paragraphs right after a callout render properly instead of as raw `## ...` text; code examples that show `:::` or `::mermaid` syntax display it. Existing heading anchors are unchanged | None |
| `llms.txt` and search text keep identifiers, file names and code intact | `NUXT_PUBLIC_SITE_NAME`, `_brand.md` and `*.md` survive; bash comments in code are no longer turned into headings | None |
| Pages are fully server-rendered: header and sidebar links and blog indexes are in the HTML, and a missing page answers HTTP 404 (it answered 200) | Crawlers see navigation and drop dead URLs; uptime monitors pointed at a page that does not exist start failing | Point monitors at `/_health`, `/_ready` or a real page |
| The OpenAPI "download spec" button works again | None | None |
| `accent_color` and `custom_css` from `_brand.md` take effect (the theme stylesheet used to override both). The accent is adjusted for 4.5:1 contrast per theme unless `accent_exact: true` | Sites with an `accent_color` change color: links, active nav items and buttons use the brand accent; very light or very dark accents are shifted per theme (logged at startup) | Review each branded site after deploying. Set `accent_exact: true` to keep the exact color, or remove `accent_color` to keep today's blue |
| Fonts (Inter, JetBrains Mono) are served by the site instead of Google Fonts | No requests to Google from readers' browsers; same look | Drop `fonts.googleapis.com` / `fonts.gstatic.com` from any CSP or privacy notice |
| Light and dark logos are both in the page and CSS shows the right one | Light-mode readers no longer see the dark logo while the page loads | None |
| Docs pages show breadcrumbs and previous/next links in sidebar order; "Edit this page" appears when `F0_EDIT_URL` is set | New navigation elements above and below docs content (classes `f0-breadcrumbs`, `f0-page-footer`, `f0-pager`) | Hide them with `custom_css` if a site does not want them |
| Site search (`/api/search`, the search box) matches word prefixes, forgives small typos and ranks title matches first | Better results while typing; result order changes. The response shape is unchanged | None |
| Feeds carry each post's full content; Atom (`/feed.atom`) and JSON Feed (`/feed.json`) join RSS; blog pages link to all three | Feed readers show whole posts; feeds are larger | None |
| Previous/next post links cover the whole blog (they stopped after the first index page) and numbered blog folders (`02-blog/`) list their posts at `/blog` | Navigation reaches older posts; blogs in numbered folders stop showing as empty | None |
| Only a folder literally named `private` (or `server`) is blocked | Pages such as `guides/private-keys` or `/servers-guide` stop returning 403 | Rename any page you relied on that block to hide |
| Files and folders starting with `_` or `.` return 404 as pages | `/blog/_config` no longer shows the config file | None |
| Raw HTML in Markdown is sanitized | `<script>`, `on*=` handlers, `javascript:` links, `<iframe srcdoc>`, `<object>`, `<embed>`, `<base>`, `<meta>`, `<link>` are removed from rendered pages | Move any intentional scripts out of content |
| SVG uploads through the admin API are rejected | Upload of `.svg` returns 400 | Add SVGs through git |
| Image `?w=`, `?h=` and `?q=` snap to fixed steps | `?w=500` serves 800px; `?q=81` serves quality 85 | None for documented sizes (400, 800, 1200 and quality 80 are unchanged). Old caps are kept: up to 3840 wide, 2160 high, quality 100 |
| Image variants are cached in `NUXT_IMAGE_CACHE_DIR` (default: system temp dir) instead of `content/.cache/images` | Content volumes stop growing; variants are re-created once after each deploy unless the directory is a volume | Optionally mount a volume and set `NUXT_IMAGE_CACHE_DIR`. An old `content/.cache` folder can be deleted |
| `accent_color` must be a valid CSS colour | An invalid value is ignored and logged | Quote hex values: `accent_color: "#2563eb"` |
| Docker builds ignore `.env` and `.env.*` (`.dockerignore`) | A fork that kept `AUTH_MODE=private` or other settings in a committed `.env` comes up with defaults: **public**, no email, no site URL. The startup log line `f0 startup validation complete` shows the `authMode` actually in effect | Before deploying, set every value from that `.env` in the site's environment with `NUXT_` names (see step 1), deploy, then rerun the step 1 check. Treat the committed values as leaked (step 2) and remove the file from git |
| All settings are read at startup from the runtime environment; `nuxt.config.ts` reads no environment variables | Values that existed only at build time no longer apply. Short names (`AUTH_MODE`, `JWT_SECRET`, ...) now work at runtime as well as the `NUXT_` names | Make sure every setting is in the runtime environment. In fork code, read server settings with `f0Config()` from `server/utils/f0-config.ts`: `useRuntimeConfig()` no longer has `authMode`, `contentDir`, `privateDir`, `jwtSecret`, the AWS keys or `emailFrom` |
| A private site without a JWT secret (or with the old `change-me-in-production` placeholder) refuses to start | The container exits with `Refusing to start` in the log; the old container keeps serving during a rolling deploy | Set `NUXT_JWT_SECRET` to 32+ random characters |
| Health check probes `/_ready` on `127.0.0.1` | Faster, lighter probes | Use `/_ready` in any dashboard health check |
| `/_ready` answers 503 `warming_up` until the home page, top navigation targets and first page of each section are rendered (at most 20 seconds); the rest warms in the background | A new container takes traffic a moment later, but its first requests are fast | If an external monitor alerts on a single 503 from `/_ready`, give it a grace period after deploys |
| Node.js 24 base image | None expected | Rebuild the image |
| Nuxt 4.5 (from 3.21); local development needs Node 22.19+ or 24.11+ | Global CSS loads as one cached stylesheet instead of being inlined in every page. Pages, URLs, anchors and APIs are unchanged; the folder layout is unchanged | Forks with their own pages, components or composables: run `npm run build` and click through them after merging. See the [Nuxt 4 upgrade guide](https://nuxt.com/docs/getting-started/upgrade) for `useFetch` data defaults (`undefined` instead of `null`) and shallow data |

## 5. After deploying

```bash
curl -s https://docs.example.com/_ready             # {"status":"ready","checks":{...}}
curl -sI https://docs.example.com/guides | head -3  # 200 public, 302 to /login private
```

Look at the startup log for warnings: a missing `NUXT_PUBLIC_SITE_URL`, or a missing `admins` list on a private site.
