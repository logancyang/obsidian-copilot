# Obsidian community review maintenance

## Purpose

`npm run review:obsidian` catches public Obsidian review findings before submission. It uses pinned upstream ESLint and Stylelint packages, npm's advisory service, and repository-owned rejection fixtures. The authenticated Obsidian review remains the final parity check.

The safety rule is simple: review compliance must not change plugin behavior, persisted data, prompts, provider semantics, or UI unless a specific blocking error requires it. Errors block; risky warnings remain visible and nonblocking.

## Stack invariants

- New Copilot-root values are checked against `app.vault.configDir`; persisted roots are not revalidated against a later config-directory change, which could silently relocate user data.
- Forbidden source suppressions were replaced with types or narrower boundaries, not runtime rewrites.
- The OpenCode Default effort row stays mounted. Unsupported models disable it with “Not supported” so the model list never shifts.
- Provider networking, async handlers, DOM creation, settings search, and risky CSS warnings were deliberately not rewritten by this stack.

## Gate stages

| Stage                      | Responsibility                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `review:obsidian:package`  | Select and validate stable or prerelease metadata plus repository release invariants             |
| `review:obsidian:source`   | Scan source, gallery code, `package.json`, and `LICENSE` with the upstream Obsidian ESLint rules |
| `review:obsidian:styles`   | Scan `src/styles/tailwind.css` and generated `styles.css`                                        |
| `review:obsidian:audit`    | Report production advisories and block critical ones                                             |
| `review:obsidian:fixtures` | Prove each blocking review family is rejected                                                    |

The same command runs in pull-request CI and in the release workflow before packaging.

## Metadata policy

- Stable versions validate `manifest.json`; prerelease versions validate `manifest-beta.json`.
- The upstream manifest rule recognizes only the `manifest.json` filename, so prerelease content is passed through `ESLint.lintText()` with that virtual filename.
- Manifest schema findings block. Copy guidance (`descriptionFormat` and `noForbiddenWords`) stays warning-only to avoid changing public copy.
- Repository checks cover only invariants missing upstream: version equality, mobile compatibility, package license declaration, and a nonempty `LICENSE`.
- `eslint-plugin-obsidianmd` does not currently export its LICENSE flat config, so the pinned package's plain-text parser is used. Revisit this internal import on every plugin upgrade.

## Audit policy

Use npm directly:

```bash
npm audit --omit=dev --audit-level=critical
```

`--audit-level` changes npm's failure threshold without hiding lower-severity reports. Registry failures also fail closed. Do not restore a custom JSON parser, severity classifier, subprocess wrapper, or audit-only fixtures.

## Retained warnings

Warnings remain for cases where automatic cleanup could change behavior or UI, including desktop Node imports, streaming `fetch`, async React callbacks, Obsidian DOM helpers, declarative settings search, `!important`, `:has()`, and manifest copy. Do not suppress them. Fix one warning family at a time with behavior-specific tests.

Provider smoke tests for Jina, Bedrock streaming/non-streaming, and legacy GitHub Copilot models are needed only when their adapters or network boundaries change.

## Maintenance checklist

When updating review tooling:

1. Upgrade one pinned review dependency at a time.
2. Inspect the lockfile and preserve unrelated runtime resolutions.
3. Classify new findings as blockers, safe mechanical warnings, or risky warnings.
4. Add a rejection fixture for every new blocking family.
5. Verify both stable and prerelease metadata paths.
6. Never weaken an error merely to restore a green baseline.
7. Run:

   ```bash
   npm run format
   npm run lint
   npm run review:obsidian
   npm run test
   npm run test:mobile-load
   npm run build
   ```

8. Confirm GitHub Actions passes from a clean checkout, then rerun the actual Obsidian community review.

Never edit `styles.css` directly; regenerate it with `npm run build:tailwind`.

## Key files

- [`eslint.review.config.mjs`](../eslint.review.config.mjs)
- [`stylelint.config.mjs`](../stylelint.config.mjs)
- [`stylelint.packaged.config.mjs`](../stylelint.packaged.config.mjs)
- [`scripts/review-obsidian-package.mjs`](../scripts/review-obsidian-package.mjs)
- [`scripts/review-obsidian-fixtures.mjs`](../scripts/review-obsidian-fixtures.mjs)
- [`src/review-fixtures/`](../src/review-fixtures/)
- [Pull-request workflow](../.github/workflows/node.js.yml)
- [Release workflow](../.github/workflows/release.yml)
