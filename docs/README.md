# Copilot documentation

The static site published at [docs.obsidiancopilot.com](https://docs.obsidiancopilot.com). It is an
[Astro Starlight](https://starlight.astro.build/) package that is independent of the plugin build:
its own `package.json`, its own lockfile, and its own dependency tree.

The guides next to this README are the single source of truth and are never modified to suit this
site. The guides carry no frontmatter and link to each other by filename, so the site adapts them at
build time: `src/docs-loader.mjs` takes each guide's opening level-one heading as its page title, and
`src/remark-published-docs.mjs` removes that heading from the body and rewrites `getting-started.md`
style links to `/getting-started/`. Slugs are the source filenames, so every guide keeps the URL it
had on the previous site minus its `/docs` prefix. Only the Markdown files directly next to this
README are published; `README.md`, `plans/`, and the non-Markdown installers stay excluded.

## Building

Astro 7 requires Node 22.12 or newer, which is ahead of what the plugin build uses. The `.nvmrc`
pins local development; set the Vercel project's Node.js Version to 22.x so the builds stay
independent.

```sh
npm ci
npm test
npm run build     # emits dist/
npm run preview   # serves the built site
```

## Deployment

Create a separate Vercel project for this site with these settings:

- **Root Directory:** `docs`
- **Framework Preset:** Astro
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Production Branch:** `master`
- **Node.js Version:** `22.x`

Attach `docs.obsidiancopilot.com` to that project. No environment variables are required.
