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

Attach `docs.obsidiancopilot.com` to that project. No environment variables are required to build
or preview the site.

## Production analytics

Analytics is optional and must remain disabled until the privacy policy is confirmed to cover the
docs subdomain. After that approval, add `PUBLIC_POSTHOG_KEY` and `PUBLIC_POSTHOG_HOST` to the
Vercel **Production** environment only, using values from the approved production configuration.
Keep their values out of the repository, issue comments, build logs, and preview environments.

After deploying, visit a few docs pages and run this query in PostHog to confirm that only the
allowlisted events and canonical paths arrive:

```sql
SELECT
  event,
  timestamp,
  properties.$host AS host,
  properties.$pathname AS path,
  properties.$referring_domain AS referring_domain
FROM events
WHERE event IN ('$pageview', '$pageleave')
  AND properties.$host = 'docs.obsidiancopilot.com'
ORDER BY timestamp DESC
LIMIT 100
```

Verify that paths contain no query strings, fragments, search terms, or ad-click identifiers, and
that no autocapture or replay events appear. To roll back, remove both variables from Vercel
Production and redeploy; the docs continue to work without analytics.
