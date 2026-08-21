# docs-site

The static site published at [docs.obsidiancopilot.com](https://docs.obsidiancopilot.com). It is an
[Astro Starlight](https://starlight.astro.build/) package that is independent of the plugin build:
its own `package.json`, its own lockfile, and its own dependency tree.

`../docs` is the single source of truth for the published guides and is never modified to suit this
site. The guides carry no frontmatter and link to each other by filename, so the site adapts them at
build time: `src/docs-loader.mjs` takes each guide's opening level-one heading as its page title, and
`src/remark-published-docs.mjs` removes that heading from the body and rewrites `getting-started.md`
style links to `/getting-started/`. Slugs are the source filenames, so every guide keeps the URL it
had on the previous site minus its `/docs` prefix. Only the Markdown files directly inside `../docs`
are published; `../docs/plans/` stays private.

## Building

Astro 7 requires Node 22.12 or newer, which is ahead of what the plugin build uses, so a Cloudflare
Pages project must set `NODE_VERSION` (or read the `.nvmrc` here) accordingly.

```sh
npm install
npm run build     # emits dist/
npm run preview   # serves the built site
```
