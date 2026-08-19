# Obsidian community review maintenance

## Purpose

`npm run review:obsidian` catches public Obsidian review findings before submission. It uses pinned upstream ESLint and Stylelint packages, npm's advisory service, and repository-owned rejection fixtures. The authenticated Obsidian review remains the final parity check.

The safety rule is simple: review compliance must not change plugin behavior, persisted data, prompts, provider semantics, or UI unless a specific blocking error requires it. Errors block; risky warnings remain visible and nonblocking.

## Stack invariants

- New Copilot-root values are checked against `app.vault.configDir`; persisted roots are not revalidated against a later config-directory change, which could silently relocate user data.
- Forbidden source suppressions were replaced with types or narrower boundaries, not runtime rewrites.
- The OpenCode Default effort row stays mounted. Unsupported models disable it with “Not supported” so the model list never shifts.
- Safe element-owned DOM creation was migrated to Obsidian helpers. Provider networking, async handlers, document-owned DOM creation, settings search, and risky CSS warnings were deliberately not rewritten by this stack.
- `src/logger.ts` is the only console boundary, and it calls only the methods upstream's `no-console` allows: `debug`, `warn`, `error`. Reaching for `console.log` or `console.table` there is not an option, because the upstream config also bans disabling `no-console` through `eslint-comments/no-restricted-disable`. `console.debug` is in the repo's own `no-restricted-syntax` logging boundary so callers cannot route around `logInfo()`.
- Type-aware ESLint rules are switched off for every file that is not `.ts`/`.tsx`, scoped by excluding TypeScript rather than by listing non-TypeScript extensions. `eslint-plugin-obsidianmd` decides which files its type-aware rules apply to and that selection differs between versions, so an extension list falls out of date silently. A type-aware rule reaching an untyped target such as `manifest.json` or `LICENSE` fails to load, and ESLint aborts the whole gate rather than reporting findings.

## Gate stages

| Stage                      | Responsibility                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `review:obsidian:package`  | Validate metadata, release invariants, and runtime-only dependency replacement guidance          |
| `review:obsidian:source`   | Scan source, gallery code, `package.json`, and `LICENSE` with the upstream Obsidian ESLint rules |
| `review:obsidian:styles`   | Scan all source/gallery CSS and generated `styles.css`                                           |
| `review:obsidian:audit`    | Report production advisories and block critical ones                                             |
| `review:obsidian:fixtures` | Prove blockers are rejected and no tracked source is ignored                                     |

The same command runs in pull-request CI and in the release workflow before packaging.

## Metadata policy

- Stable versions validate `manifest.json`; prerelease versions validate `manifest-beta.json`.
- The upstream manifest rule recognizes only the `manifest.json` filename, so prerelease content is passed through `ESLint.lintText()` with that virtual filename.
- Manifest schema findings block. Copy guidance (`descriptionFormat` and `noForbiddenWords`) stays warning-only to avoid changing public copy.
- Repository checks cover only invariants missing upstream: version equality, mobile compatibility, package license declaration, and a nonempty `LICENSE`.
- `eslint-plugin-obsidianmd` does not currently export its LICENSE flat config, so the pinned package's plain-text parser is used. Revisit this internal import on every plugin upgrade.

## Dependency policy

The package stage applies the upstream `depend/ban-dependencies` guidance to a virtual `package.json` containing production dependencies only. This catches runtime package replacement recommendations without falsely reporting packages used only by tests or development tooling. These findings remain warnings; production audit failures follow the separate audit policy below.

## Audit policy

Use npm directly:

```bash
npm audit --omit=dev --audit-level=critical
```

`--audit-level` changes npm's failure threshold without hiding lower-severity reports. Registry failures also fail closed. Do not restore a custom JSON parser, severity classifier, subprocess wrapper, or audit-only fixtures.

## Retained warnings

Warnings remain for cases where automatic cleanup could change behavior or UI, including desktop Node imports, streaming `fetch`, async React callbacks, Obsidian DOM helpers, declarative settings search, `!important`, `:has()`, and manifest copy. Do not suppress them. Fix one warning family at a time with behavior-specific tests.

### Permanent `fetch` disclosures

`requestUrl` supports neither streaming responses nor AbortSignal, so the following call site must keep `fetch` and carry a `// scorecard:` comment. Any remaining scorecard `fetch` warning must match this list:

- `src/LLMProviders/ChatLMStudio.ts` — `window.fetch` fallback wrapped for LM Studio body sanitization in a streaming ChatOpenAI.

Non-streaming JSON requests route through `safeFetchNoThrow`, which uses `requestUrl`. These include the Jina and custom OpenAI embedding adapters and every Amazon Bedrock request.

Provider smoke tests for Jina and Bedrock are needed only when their adapters or network boundaries change.

## Maintenance checklist

When updating review tooling:

1. Compare any hosted-review mismatch with the latest official Obsidian lint package releases.
2. Upgrade one pinned review dependency at a time.
3. Inspect the lockfile and preserve unrelated runtime resolutions.
4. Classify new findings as blockers, safe mechanical warnings, or risky warnings.
5. Add a regression fixture outside review source roots for every newly discovered family.
6. Verify both stable and prerelease metadata paths.
7. Never suppress, ignore, or weaken a rule merely to restore a green baseline.
8. Run:

   ```bash
   npm run format
   npm run lint
   npm run review:obsidian
   npm run test
   npm run test:mobile-load
   npm run build
   ```

9. Confirm GitHub Actions passes from a clean checkout, then rerun the actual Obsidian community review.

Never edit `styles.css` directly; regenerate it with `npm run build:tailwind`.

## Key files

- [`eslint.review.config.mjs`](../eslint.review.config.mjs)
- [`stylelint.config.mjs`](../stylelint.config.mjs)
- [`stylelint.packaged.config.mjs`](../stylelint.packaged.config.mjs)
- [`scripts/review-obsidian-package.mjs`](../scripts/review-obsidian-package.mjs)
- [`scripts/review-obsidian-fixtures.mjs`](../scripts/review-obsidian-fixtures.mjs)
- [Pull-request workflow](../.github/workflows/node.js.yml)
- [Release workflow](../.github/workflows/release.yml)
