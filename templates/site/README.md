# f0 site template

A site repository that holds only content. The f0 engine (the app) comes from
the published image, so deploys copy files instead of building the app.

```
content/        Markdown, nav.md, _brand.md, assets/
private/        allowlist.json (private sites only)
Dockerfile      FROM the f0 engine image
.dockerignore   only content/ and private/ reach the build
```

## Start a site

1. Copy this folder into a new repository and add your `content/`.
2. Pin the engine: set `F0_IMAGE` in the Dockerfile (or as a Coolify build
   variable) to a released tag or digest, e.g. `ghcr.io/folder0/f0:1.0.0`.
3. Deploy with Coolify's Dockerfile build pack. Health check: `/_ready` on port 3000.
4. Set settings in the runtime environment (see f0's README), never as build
   arguments.

## Move an existing fork to this layout

1. Note any engine changes your fork made (`git diff f0/master -- . ':!content' ':!private'`).
   Send generic ones upstream to f0 first.
2. In the fork, replace the Dockerfile and `.dockerignore` with these two files,
   then delete the app source (everything except `content/`, `private/` and the
   two files).
3. Deploy once with the same runtime environment, and check `/_ready`, a few
   pages, and (for private sites) that anonymous requests redirect to `/login`.

## Upgrade f0

Change `F0_IMAGE` to the new tag or digest and redeploy. Roll back by setting
it back.
