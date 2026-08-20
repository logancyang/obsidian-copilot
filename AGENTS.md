# AGENTS.md

This file provides guidance to any coding agent when working with code in this repository.

## Overview

Copilot for Obsidian is an AI-powered assistant plugin that integrates various LLM providers (OpenAI, Anthropic, Google, etc.) and coding agents (claude code, codex, opencode) with Obsidian. It provides chat interfaces, semantic search, and various AI-powered commands for note-taking and knowledge management.

## Commands

- **NEVER RUN `npm run dev`** — the user handles all builds manually.
- `npm run build` — production build (TypeScript check + minified output).
- `npm run lint` / `npm run lint:fix` — ESLint check / autofix.
- `npm run format` / `npm run format:check` — Prettier write / check.
- **Before PR: always run `npm run format && npm run lint`.**
- `npm run test` — unit tests. `npm run test:integration` — integration (needs API keys). Single test: `npm test -- -t "test name"`.
- `npm run test:vault` — macOS-only build-and-deploy into `$COPILOT_TEST_VAULT_PATH`; see [`TESTING_GUIDE.md`](./designdocs/agents/TESTING_GUIDE.md).

## Core principles (apply to every change)

- **Always write generalizable solutions.** No hardcoded folder names, file patterns, or special-case logic (no "piano notes" / "daily notes" branches). Make varying behavior configurable, not hardcoded.
- **Never modify AI prompt content** — system prompts, model adapter prompts, etc. — unless the user explicitly asks.
- **Use stories for user-visible React work.** When a feature adds or changes a component or a meaningful visual state, add or update its adjacent `*.stories.tsx` file and verify the rendered states in the component gallery. Stories complement unit tests; non-visual changes do not require one. Follow the [`Component gallery workflow`](./designdocs/agents/TESTING_GUIDE.md#component-gallery-workflow).
- **Referential stability.** Never return a freshly-allocated `[]` / `{}` for an "empty" slice; return a frozen module-level constant (canonical examples: `EMPTY_PROVIDERS` / `EMPTY_CONFIGURED_MODELS` / `EMPTY_BACKENDS` in `src/settings/model.ts`).
- **Structure unit tests by module, class, and callable.** Use exactly one top-level `describe("moduleName", ...)` for the module under test; do not split the same subject across multiple top-level `describe` blocks. Within that module suite, wrap each class's tests in exactly one `describe("ClassName", ...)` so method ownership remains visible, then give each method exactly one nested `describe("methodName()", ...)` group. Keep module-level functions directly under the module suite, with exactly one `describe("functionName()", ...)` group per function. Merge cases that exercise the same callable. Separate same-callable groups only when a material test-lifecycle constraint makes merging misleading, and document that reason next to the groups. Write `it(...)` descriptions that state the observable behavior without requiring the reader to inspect the test body.
- **Preserve provenance for new behavioral branches and edge cases.** When a change adds a conditional branch or explicit edge-case path, include the originating GitHub issue's full URL in both the nearby code comment that explains why the path exists and the `it(...)` description that covers it. If no issue exists, create one before landing the behavior. Explain the user or reliability failure that justified the path, not its mechanics.
- **Pair every production TypeScript function and method with unit coverage.** Directly test exported and public callables; cover private and module-local helpers through their observable public contract unless direct isolation materially improves clarity. Test-only helper functions are exempt.
- **Document exported functions and public methods of exported classes when their purpose, contract, or parameters are not self-evident.** Simple functions and methods with unambiguous names and parameters may omit JSDoc. When JSDoc is needed, explain why the callable exists and the goal it serves without repeating its implementation, and add an `@param` entry for every parameter that explains its meaning without repeating its TypeScript type.
- **Document every exported class with JSDoc.** State what the class is responsible for managing and where its boundary ends so readers can understand its duty without reading the implementation.
- **Never call `console` directly** — use `logInfo()` / `logWarn()` / `logError()` from `@/logger`.
- **Write standalone comments for first-time readers.** Explain only the current code's non-obvious constraints without relying on PR or implementation history; document an older state only when supporting it is part of the current compatibility contract. Keep comments minimal, explain why rather than what, and omit milestone/plan-step refs. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **Never edit `styles.css`** (generated); edit `src/styles/tailwind.css`, no inline `style`, no arbitrary font sizes, wrap class strings in `cn()`. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **TypeScript:** `@/` absolute imports; `interface` for shapes, `type` for unions. **React:** custom hooks, props interfaces above components. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **Never use the global `app`** (footgun in popouts, hides dependencies); thread it via `useApp()` or a parameter. → [`PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md)

## Task-specific guides

Read the matching guide when your task touches that area — they aren't loaded by default.

| When you're…                                                          | Read                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| writing or altering tests, or doing E2E via the Obsidian CLI          | [`designdocs/agents/TESTING_GUIDE.md`](./designdocs/agents/TESTING_GUIDE.md)                    |
| building or changing user-visible React components or visual states   | [`Component gallery workflow`](./designdocs/agents/TESTING_GUIDE.md#component-gallery-workflow) |
| writing code: DI/structure, TypeScript, React, comments, CSS/Tailwind | [`designdocs/agents/STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)                        |
| touching plugin runtime: the `app`, network requests, popout windows  | [`designdocs/agents/PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md)              |
| running a multi-step dev session                                      | [`designdocs/agents/PROCESS_GUIDE.md`](./designdocs/agents/PROCESS_GUIDE.md)                    |
| changing user-facing behavior                                         | [`designdocs/agents/DOCS_GUIDE.md`](./designdocs/agents/DOCS_GUIDE.md)                          |
| reviewing code or preparing an Obsidian submission                    | [`designdocs/OBSIDIAN_COMMUNITY_REVIEW.md`](./designdocs/OBSIDIAN_COMMUNITY_REVIEW.md)          |

## Important notes

- The plugin supports multiple LLM providers with custom endpoints.
- Vector store requires rebuilding when switching embedding providers.
- Settings are versioned — migrations may be needed.
- Local model support via Ollama / LM Studio.
- Rate limiting is implemented for all API calls.
- Message & chat architecture (Repository → Manager → UIState → UI; single `MessageRepository`; per-project isolation) → [`designdocs/MESSAGE_ARCHITECTURE.md`](./designdocs/MESSAGE_ARCHITECTURE.md).
- Tech debt and known issues → [`designdocs/todo/TECHDEBT.md`](./designdocs/todo/TECHDEBT.md). Current session plan → [`TODO.md`](./TODO.md).
- Available Tailwind tokens/classes → [`tailwind.config.js`](./tailwind.config.js).

## Obsidian review guidelines

When reviewing code or preparing a PR that changes plugin source, CSS, package metadata, or dependencies, run `npm run review:obsidian` and inspect its warning output. Obsidian review errors are blockers. Fix warnings only when runtime, UI, and persisted behavior remain equivalent; leave risky warnings visible and nonblocking.

Review changed lines for desktop-only Node imports, `fetch` outside justified streaming adapters, async callbacks passed to void-returning APIs, global `app` access, console use, deprecated APIs, runtime dependency replacements, native DOM creation instead of Obsidian helpers, external CSS URLs, `!important`, and `:has()`. Never suppress, ignore, or downgrade a review rule just to make the gate green.

If the authenticated community review finds something the local gate missed, first check the pinned official Obsidian lint packages, then add a regression fixture outside source roots. See [`designdocs/OBSIDIAN_COMMUNITY_REVIEW.md`](./designdocs/OBSIDIAN_COMMUNITY_REVIEW.md) for the parity and risk policy.

<!-- brevilabs-review-guidelines:start (synced from Brevilabs/brevilabs-skills — edit there, not here) -->

## Review guidelines

Apply these in addition to the built-in review. Report only problems
introduced or exposed by this pull request, and describe the concrete failure
scenario for each finding rather than giving general advice.

Priorities, in order:

1. **Correctness** — logic errors, data loss, unhandled failure paths,
   concurrency hazards.
2. **Security** — authorization bypass, injection, secrets or private data
   leaving the codebase.
3. **Breaking changes and migrations** — changed function signatures, renamed
   or removed exports, altered return shapes, changed defaults, tightened
   validation; persisted schemas, settings files, and serialized formats that
   already-written data must still load. A change that needs a migration and
   ships without one is a defect. When a migration exists, check that it
   handles already-in-the-wild states, not just the happy path.
4. **Code budget** — added lines are spend, not progress. A change that
   solves the problem in fewer concepts beats one that solves it in more; the
   best diff is the smallest one that does the job.
5. **Tests** — changed behavior, failure paths, and boundary cases are
   covered, and tests assert behavior rather than implementation detail.

Severity calibration:

- Treat as P1: an unhandled breaking change to a public API, plugin interface,
  CLI flag, or wire format; a change requiring a migration that ships without
  one; a data-corrupting or destructive operation; an authorization bypass; a
  reproducible crash.
- Also treat as P1: a diff carrying substantial code the problem does not
  require — a speculative abstraction with a single caller, configurability
  nothing asks for, premature optimization without a measurement showing the
  need, defensive branches guarding states that cannot occur, or a
  reimplementation of a helper that already exists in the codebase. Rank
  smaller instances of the same problems P2/P3 rather than dropping them. An
  over-engineering finding must name the simpler shape that solves the same
  problem; a bare "consider simplifying" is not a finding.
- Never report naming, formatting, or style that automated checks enforce, at
  any priority.

Code-budget checks:

- Prefer fixes that remove code; say so when a net-negative diff is available.
- Flag dead code the change itself creates — superseded branches, obsolete
  fallbacks, stale tests — deletion belongs in the same PR.
- Do not suggest broad refactors of pre-existing code unless required to fix
  a reported defect; the budget applies to what this PR adds, not to what was
  already there.

## Responding to review comments

Reply with the endpoint that publishes immediately, where `ROOT_COMMENT_ID` is
the thread's top-level comment:

```bash
gh api -X POST repos/OWNER/REPO/pulls/PR/comments/ROOT_COMMENT_ID/replies -f body="..."
```

Never open a review draft: `POST /pulls/PR/reviews` without an `event` (and the
UI's "Start a review") leaves the reply _pending_, which means invisible — it
never reaches the reviewer, it is absent from the comments API, and its thread
still reads as unanswered. Before finishing, confirm none exists:

```bash
gh api repos/OWNER/REPO/pulls/PR/reviews --jq '[.[]|select(.state=="PENDING")]|length'   # must be 0
```

<!-- brevilabs-review-guidelines:end -->
