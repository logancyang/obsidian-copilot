# Agent Mode — system-prompt override

> Design doc. Captures how Copilot's Agent Mode replaces opencode's default coding-agent system prompt with a Copilot-specific prompt for both `build` (default) and `plan` modes. Companion to [`AGENT_MODE.md`](./AGENT_MODE.md).

## 1. Context

opencode is the BYOK ACP backend behind Agent Mode (see [`AGENT_MODE.md`](./AGENT_MODE.md)). It ships opinionated **coding-agent** system prompts — `prompt/anthropic.txt`, `beast.txt`, `gpt.txt`, `default.txt`, etc. — selected per turn by substring-matching on the model name (`opencode/packages/opencode/src/session/system.ts:20-34`). Those prompts bake in software-engineering identity, repo workflows, and code-style conventions.

For an Obsidian vault assistant, that identity is **wrong, not just missing**: the agent operates on markdown notes, not source files; the user's intent is knowledge management and writing assistance, not refactoring TypeScript. Appending a Copilot addendum on top of opencode's coding prompt produces an agent torn between two identities. We need Copilot's own prompt to drive both the default ("build") and plan modes.

## 2. What ACP itself does and doesn't expose

- ACP `NewSessionRequest`, `PromptRequest`, `LoadSessionRequest` have **no** `system` / `instructions` / `customPrompt` field. The wire protocol does not expose system-prompt override.
- opencode's internal `user.system` (per-message) is not surfaced through ACP either.
- Override must therefore go through opencode's **config layer**. Copilot already drives that via the `OPENCODE_CONFIG_CONTENT` env var on subprocess spawn (`src/agentMode/backends/opencode/OpencodeBackend.ts:53-71`).

## 3. How opencode assembles the system prompt

`opencode/packages/opencode/src/session/llm.ts:102-114`:

```ts
const system: string[] = [];
system.push(
  [
    ...(input.agent.prompt ? [input.agent.prompt] : SystemPrompt.provider(input.model)),
    ...input.system,
    ...(input.user.system ? [input.user.system] : []),
  ]
    .filter((x) => x)
    .join("\n")
);
```

Three sources, in order:

1. **Agent prompt or provider default.** If the active agent has a `prompt` set, it replaces the provider default entirely. Otherwise opencode picks a provider default by substring-matching the model name (`session/system.ts:20-34`):

   | Model name contains   | Prompt file used       |
   | --------------------- | ---------------------- |
   | `gpt-4` / `o1` / `o3` | `prompt/beast.txt`     |
   | `gpt` + `codex`       | `prompt/codex.txt`     |
   | other `gpt`           | `prompt/gpt.txt`       |
   | `gemini-`             | `prompt/gemini.txt`    |
   | `claude`              | `prompt/anthropic.txt` |
   | `trinity`             | `prompt/trinity.txt`   |
   | `kimi`                | `prompt/kimi.txt`      |
   | else                  | `prompt/default.txt`   |

   Note: Copilot Plus inherits whichever family-specific prompt the underlying model name matches — the `copilot-plus` provider id is irrelevant here; only the model name string is inspected.

2. **`input.system`** — collected from `Instruction.system()`: AGENTS.md / CLAUDE.md / CONTEXT.md walked up from the cwd, plus anything listed in `config.instructions` (file paths, glob patterns, or `https?://` URLs). See `opencode/packages/opencode/src/session/instruction.ts:122-170`.

3. **`input.user.system`** — per-message system text. Internal API only; not reachable via ACP.

After assembly, opencode invokes a `experimental.chat.system.transform` plugin hook that lets a loaded plugin mutate the array in place. Heavier than what we need.

## 4. Agents, a.k.a. session modes

`opencode/packages/opencode/src/agent/agent.ts:107` defines native agents. The two primary, user-selectable ones are:

- **`build`** — default. Permissive (allow edits, tools). No `prompt:` set → falls back to provider default.
- **`plan`** — `edit: deny` permission. No `prompt:` set → falls back to provider default.

There are also hidden ones (`title`, `summary`, `compaction`) that already carry custom prompts, and subagents (`general`, `explore`) that aren't user-selectable as a session mode.

`agent.ts:236-263` then merges anything under `cfg.agent.<id>` into the matching native agent — including `prompt`, `permission`, `model`, `temperature`, etc. The override is field-wise: setting `prompt` does not disturb `permission`, `mode`, or `native: true`. **This is the lever.** Stamping `prompt:` onto `build` and `plan` overrides the provider default while preserving native permissions and visibility in `availableModes`.

The wire-level toggle between modes is the ACP `setSessionMode({ sessionId, modeId })` method (`opencode/packages/opencode/src/acp/agent.ts:1313-1320`). It validates `modeId` against `loadAvailableModes(cwd)` and throws `Agent not found: <id>` otherwise. `availableModes` and `currentModeId` are returned in `NewSessionResponse.modes` (`agent.ts:1163-1176`).

## 5. Decision: replace, not append

Append vs. replace tradeoffs:

|                              | Append (`config.instructions`)                  | Replace (`cfg.agent.<id>.prompt`)            |
| ---------------------------- | ----------------------------------------------- | -------------------------------------------- |
| Identity collision           | Coding-agent identity remains, fights addendum  | Clean — only Copilot's identity is in scope  |
| Token / cache stability      | Larger header, varies by provider default       | Stable, smaller, single source               |
| Cross-model parity           | Different base prompt per model name            | One baseline everywhere                      |
| Future opencode improvements | Auto-pickup (sometimes desired)                 | Pinned (review on opencode upgrade)          |
| Plan / build distinction     | Free (provider default has plan-mode awareness) | Requires explicit plan-mode addendum         |
| Implementation cost          | One textarea + a file path                      | Maintain Copilot prompts; address each model |

**Decision:** **replace**, applied to both `build` and `plan`.

Use `config.instructions` (append) only for _additive_ per-vault context — e.g. an `AGENTS.md` the user maintains in their vault. The two compose: replacement handles identity; instructions handle per-vault context.

## 6. Final design

Inject prompts via `cfg.agent` in `OPENCODE_CONFIG_CONTENT`:

```ts
config.agent = {
  build: { prompt: COPILOT_PROMPT_BASE },
  plan: { prompt: COPILOT_PROMPT_BASE + "\n\n" + COPILOT_PLAN_ADDENDUM },
};
```

Why this works:

- `build` and `plan` are merged from native agents (`agent.ts:236-263`), so their permissions (build = permissive, plan = edit-deny) and visibility in `availableModes` are preserved.
- Mode toggle via `setSessionMode("plan" | "build")` keeps working — same wire affordance opencode already exposes.
- One env var carries everything; no temp files, no `OPENCODE_CONFIG_DIR`, no agent markdown to manage on disk.

Why plan mode needs its own addendum: opencode's `edit: deny` permission blocks the _tool call_, but the model still needs to _know_ it's in plan mode so it produces a written plan instead of attempting edits and getting rejected per turn. Opencode's provider defaults handle this implicitly (Anthropic's prompt has plan-mode awareness baked in). Our replacement must state it explicitly. Suggested wording for `COPILOT_PLAN_ADDENDUM`:

> You are in plan mode. Do not modify files. Produce a written plan grounded in what's actually in the vault, then stop and wait for approval before executing.

## 7. Implementation — minimum viable path

1. **Author prompts.** New file `src/agentMode/backends/opencode/prompts.ts` exporting `COPILOT_PROMPT_BASE` and `COPILOT_PLAN_ADDENDUM` as TS string constants. Port from Copilot's existing chat system prompt, dropping renderer-specific bits that don't apply when an agent is driving tools (e.g. wikilink rendering instructions intended for the chat surface, not for tool calls).

2. **(Optional) User override setting.** Add `agentMode.backends.opencode.systemPromptOverride?: string` to `CopilotSettings` in `src/settings/model.ts`. Skip for v1 if a fixed prompt is acceptable; can be added later without migration.

3. **Inject in `buildOpencodeConfig()`** (`src/agentMode/backends/opencode/OpencodeBackend.ts:89-194`). Just before `return config`:

   ```ts
   const base =
     getSettings().agentMode?.backends?.opencode?.systemPromptOverride ?? COPILOT_PROMPT_BASE;
   config.agent = {
     build: { prompt: base },
     plan: { prompt: base + "\n\n" + COPILOT_PLAN_ADDENDUM },
   };
   ```

4. **Tests.** Extend `src/agentMode/backends/opencode/OpencodeBackend.test.ts` (already exercises `buildOpencodeConfig`) to assert:
   - `config.agent.build.prompt === COPILOT_PROMPT_BASE` when no override is set.
   - `config.agent.plan.prompt` ends with `COPILOT_PLAN_ADDENDUM`.
   - The override setting, when populated, replaces `COPILOT_PROMPT_BASE` in both fields.

After step 3 ships, the override is in effect for every new opencode session.

## 8. Follow-up: surface plan-mode toggle in UI

Today the Copilot UI has no way to call `setSessionMode`, so users always run in `build`. The prompt override is independent of this — it works without the toggle — but to expose plan mode end-to-end:

- `src/agentMode/acp/AcpBackendProcess.ts` — add `setSessionMode({ sessionId, modeId })`, mirroring the `setSessionModel` pattern at lines 199-230 (try call, cache support flag, throw `MethodUnsupportedError` if absent).
- `src/agentMode/session/AgentSession.ts` — add `changeMode(modeId)`, mirroring `changeModel` at lines 122-141.
- `AgentSessionManager` and the chat UI — surface `availableModes` (already returned by `newSession`) and add a toggle next to the model picker.

## 9. Verification

1. `npm run lint && npm run test` — confirm new unit tests pass.
2. `npm run build` then `/Applications/Obsidian.app/Contents/MacOS/obsidian plugin:reload id=copilot`.
3. Start an Agent Mode session, send "what are you?" — answer should reflect Copilot identity, not opencode's "I'm a software engineer / defensive security tool" framing.
4. Confirm the prompt actually landed: tail the ACP frame log (commit `aa34c82` logs every JSON-RPC frame in debug mode) or run opencode with `OPENCODE_LOG_LEVEL=debug` on the spawned process and grep its log for the system prompt.
5. Once step 8 ships: switch to plan mode and confirm the model produces a written plan instead of attempting to edit.

## 10. Critical files

**Read-only (opencode internals, for reference):**

- `opencode/packages/opencode/src/session/system.ts` — provider-default selection
- `opencode/packages/opencode/src/session/llm.ts:102-114` — system-array assembly
- `opencode/packages/opencode/src/session/instruction.ts:122-170` — `instructions` resolution
- `opencode/packages/opencode/src/agent/agent.ts:107-263` — native agents and `cfg.agent` merge
- `opencode/packages/opencode/src/acp/agent.ts:1313-1320` — `setSessionMode` handler

**To edit (Copilot side):**

- `src/agentMode/backends/opencode/prompts.ts` _(new)_
- `src/agentMode/backends/opencode/OpencodeBackend.ts`
- `src/agentMode/backends/opencode/OpencodeBackend.test.ts`
- `src/settings/model.ts` _(optional, for override setting)_

**To edit for follow-up §8:**

- `src/agentMode/acp/AcpBackendProcess.ts`
- `src/agentMode/session/AgentSession.ts`
- A UI component near the model picker

## 11. Out of scope

- Authoring the contents of `COPILOT_PROMPT_BASE` itself — separate writing task; should track Copilot's existing chat system prompt where applicable.
- The `setSessionMode` UI toggle — captured as §8 follow-up, not designed in detail here.
- Per-vault `AGENTS.md` plumbing — flagged as compositional with `config.instructions` but not designed here.
- `experimental.chat.system.transform` plugin hook — strictly more powerful than `cfg.agent.<id>.prompt` but requires shipping an opencode plugin file; rejected for complexity.
