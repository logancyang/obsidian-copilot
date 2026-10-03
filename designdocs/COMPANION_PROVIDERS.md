# Companion providers: Grok, Muse Code, and Antigravity

This note describes how three additional Agent Mode backends are implemented. The plugin name, id, and existing guides are unchanged. OpenCode remains the recommended backend. Claude Code, Codex, and OpenCode keep their existing processes.

## Process shape

Each backend is a `BackendDescriptor` registered in `src/agentMode/backends/registry.ts`. `createCompanionDescriptor` in `src/agentMode/backends/shared/companionDescriptor.tsx` builds that descriptor from a small definition: id, display name, CLI binary name, installer URL, login arguments, skills directory, and whether automatic tools need consent.

At chat start the plugin does not spawn the vendor CLI itself. It spawns a Node.js 20 or newer process whose script is `companion-<id>.cjs` in the plugin directory, next to `main.js`. That process speaks Copilot's Agent Client Protocol on stdio and owns the vendor CLI. The spawn environment sets `ELECTRON_RUN_AS_NODE=1`, `COMPANION_CLI_PATH` to the configured binary, and `COMPANION_SYSTEM_PROMPT` from the existing agent instruction builder. Node is resolved from `COMPANION_NODE_PATH` or from `node` on `PATH`. The basename must be `node` or `node.exe`, and the major version must be at least 20.

`npm run build` typechecks `adapters/companions` with `tsconfig.companion-adapters.json`, then the esbuild plugin in `scripts/companionAdapters.mjs` writes:

- `companion-grok.cjs` from `adapters/companions/grok.ts`
- `companion-antigravity.cjs` from `adapters/companions/antigravity-main.ts`
- `companion-muse.cjs` from `adapters/companions/muse/main.mts`

Those files, plus the license copies the plugin writes beside them, are gitignored build output. They are not part of `main.js`.

Obsidian Community Plugins installs `main.js`, `manifest.json`, and `styles.css` only. A normal community update therefore does not place the three adapter scripts in the plugin directory. If a script is missing, setup fails with that explanation. This change does not add a downloader and does not change the release workflow.

## Settings

Backend ids `grok`, `antigravity`, and `muse` extend `AgentType`. Their settings follow the Codex backend shape, plus `automaticToolsConsent` for Antigravity. `binaryPath`, `binaryVersion`, `binarySource`, and `envOverrides` are device-local, same as the other local CLIs, so a synced vault does not copy a path from another computer. Consent stays with the synced backend settings.

Configure can detect the CLI, accept a path, run the vendor installer script (`installerBaseUrl` plus `.ps1` on Windows or `.sh` elsewhere), and sign in. Install and update restart that backend through `AgentSessionManager.restartBackend` with a `maintenance` callback, so the CLI is replaced only while the process is down. Detection on plugin load is best-effort and does not prompt.

Model ids come from the adapter catalog. Effort options are prefetched when the backend exposes them. If a saved companion session cannot be resumed, the user must open the saved history or explicitly start a new chat. The backend does not silently replace that session.

## Grok

Definition: binary `grok`, installer `https://x.ai/cli/install`, login `grok login`, skills under `.grok/skills`.

`companion-grok.cjs` runs `grok agent stdio` and translates ACP frames to that protocol. It advertises modes `default` (Agent), `plan` (Plan), and `yolo` (YOLO). Copilot maps its Default, Plan, and Auto controls onto `default`, `plan`, and `yolo` when the CLI reports those modes.

The configured binary must report a version. Grok older than 0.2.117 is rejected. On Windows, 0.2.61 through 0.2.70 are rejected because their stdio transport is broken.

## Antigravity (Gemini)

Definition: binary `agy`, installer `https://antigravity.google/cli/install`, no login arguments on the descriptor, skills under `.agents/skills`, `automaticTools: true`.

`companion-antigravity.cjs` hosts the Antigravity ACP adapter. Plan-exit requests from the CLI are presented as Copilot permission requests. Session list and close capabilities are advertised on initialize.

A chat does not start until `automaticToolsConsent` is true. The home view shows a notice that Antigravity approves tools itself and can edit files and run commands without Copilot's permission dialogs. That consent is separate from native Plan review.

## Muse Code

Definition: binary `muse`, installer `https://dev.meta.ai/install`, login `muse login`, skills under `.agents/skills`.

`companion-muse.cjs` bundles `@muse-code/sdk` (`1.3.0`) and translates ACP session and prompt calls into Muse SDK turns. On non-macOS hosts the environment sets `TBH_CREDENTIAL_BACKEND=file` when the user has not set it.

The adapter reports `promptCapabilities.image` and `embeddedContext` as false, and `session/prompt` rejects anything other than text with "Muse adapter accepts text prompts only". It rejects client MCP servers. It rejects Plan mode and any approval mode it does not recognize. Default maps to `agent` or `onRequest`. Auto maps to `yolo`.

## Shared behavior that existing backends also see

`AgentSessionManager` refreshes an effort catalog when the enabled-model list of a backend with `prefetchEffortCatalog` changes. The model picker can show effort discovery as loading, ready, unsupported, or error. `executionNotice` renders under the agent tab strip only when a descriptor sets it. Today only Antigravity does.

Two small spawn fixes travel with this change. Codex command failures reject with `new Error(error.message)` instead of the raw exec error. The debug sink binds `process.getuid` to `process` when that function exists.

## License

Copilot remains AGPL-3.0. See `LICENSE`.

The Antigravity adapter, the Muse adapter, and diff synthesis are ported from [All your Companions](https://github.com/zfzfg/all-your-companions) at commit `91d216aaa8c680811034abd44e4be9eb8cee178e`. That source is Functional Source License, Version 1.1, MIT Future License (FSL-1.1-MIT). Copyright notices for Paweł Huryn and Collin Lerche stay in `adapters/companions/AYC-LICENSE`. `adapters/companions/PROVENANCE.md` records the port. The built adapter keeps the FSL text as a banner, and the build also writes `COMPANION-LICENSE` and `COMPANION-PROVENANCE.md` next to the scripts.

FSL-1.1-MIT is not a grant to relicense those files as AGPL-3.0. It converts to MIT on the second anniversary of the version's availability, and until then it prohibits competing commercial use. This repository does not strip those terms and does not claim the port is AGPL or already MIT. The Muse SDK keeps its own MIT license, copied to `MUSE-SDK-LICENSE` at build time from `@muse-code/sdk`.

Upstream can accept this code only if the copyright holders grant the ported portions under terms compatible with AGPL-3.0. Keeping the notices is not that grant.
