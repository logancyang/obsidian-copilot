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
- **Referential stability.** Never return a freshly-allocated `[]` / `{}` for an "empty" slice; return a frozen module-level constant (canonical examples: `EMPTY_PROVIDERS` / `EMPTY_CONFIGURED_MODELS` / `EMPTY_BACKENDS` in `src/settings/model.ts`).
- **Never use `console.log`** — use `logInfo()` / `logWarn()` / `logError()` from `@/logger`.
- **Comment the why, not the what;** minimal comments, no milestone/plan-step refs. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **Never edit `styles.css`** (generated); edit `src/styles/tailwind.css`, no inline `style`, no arbitrary font sizes, wrap class strings in `cn()`. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **TypeScript:** `@/` absolute imports; `interface` for shapes, `type` for unions. **React:** custom hooks, props interfaces above components. → [`STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)
- **Never use the global `app`** (footgun in popouts, hides dependencies); thread it via `useApp()` or a parameter. → [`PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md)

## Task-specific guides

Read the matching guide when your task touches that area — they aren't loaded by default.

| When you're…                                                          | Read                                                                               |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| writing or altering tests, or doing E2E via the Obsidian CLI          | [`designdocs/agents/TESTING_GUIDE.md`](./designdocs/agents/TESTING_GUIDE.md)       |
| writing code: DI/structure, TypeScript, React, comments, CSS/Tailwind | [`designdocs/agents/STYLE_GUIDE.md`](./designdocs/agents/STYLE_GUIDE.md)           |
| touching plugin runtime: the `app`, network requests, popout windows  | [`designdocs/agents/PLUGIN_DEV_GUIDE.md`](./designdocs/agents/PLUGIN_DEV_GUIDE.md) |
| using a specific LLM provider (e.g. AWS Bedrock)                      | [`designdocs/agents/VENDOR_GUIDE.md`](./designdocs/agents/VENDOR_GUIDE.md)         |
| running a multi-step dev session                                      | [`designdocs/agents/PROCESS_GUIDE.md`](./designdocs/agents/PROCESS_GUIDE.md)       |
| changing user-facing behavior                                         | [`designdocs/agents/DOCS_GUIDE.md`](./designdocs/agents/DOCS_GUIDE.md)             |

## Important notes

- The plugin supports multiple LLM providers with custom endpoints.
- Vector store requires rebuilding when switching embedding providers.
- Settings are versioned — migrations may be needed.
- Local model support via Ollama / LM Studio.
- Rate limiting is implemented for all API calls.
- Message & chat architecture (Repository → Manager → UIState → UI; single `MessageRepository`; per-project isolation) → [`designdocs/MESSAGE_ARCHITECTURE.md`](./designdocs/MESSAGE_ARCHITECTURE.md).
- Tech debt and known issues → [`designdocs/todo/TECHDEBT.md`](./designdocs/todo/TECHDEBT.md). Current session plan → [`TODO.md`](./TODO.md).
- Available Tailwind tokens/classes → [`tailwind.config.js`](./tailwind.config.js).

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
4. **Tests** — changed behavior, failure paths, and boundary cases are
   covered, and tests assert behavior rather than implementation detail.

Classification (this reviewer surfaces only P0/P1 findings):

- Treat as P1: an unhandled breaking change to a public API, plugin interface,
  CLI flag, or wire format; a change requiring a migration that ships without
  one; a data-corrupting or destructive operation; an authorization bypass; a
  reproducible crash.
- Never classify naming, formatting, or optional cleanup as P1. Formatting and
  style are enforced by automated checks; do not comment on them.

Scope discipline:

- Prefer fixes that remove code. Flag a new helper duplicating one that
  already exists, dead code the change itself creates, or a speculative
  abstraction with a single caller — but only when it conceals or causes a
  real defect.
- Do not suggest broad refactors unless required to fix a reported defect.
<!-- brevilabs-review-guidelines:end -->
