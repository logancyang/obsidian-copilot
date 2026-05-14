# ACP Protocol & `claude-agent-acp` Wrapper: Concrete Limitations Encountered During SDK Migration

**From:** Obsidian Copilot plugin team
**Re:** Migration from `@agentclientprotocol/claude-agent-acp` → `@anthropic-ai/claude-agent-sdk`
**Status:** Feedback / RFC. We still ship `@agentclientprotocol/sdk` for our OpenCode and Codex backends; this is not a teardown.

---

## TL;DR

We ship Copilot for Obsidian, an Obsidian plugin that runs an in-vault AI agent inside an Electron renderer. We've used `@agentclientprotocol/claude-agent-acp` (v0.31.4) for our Claude backend since launch. As Claude Code / Claude Agent SDK matured, we hit a series of capability ceilings that ACP-as-a-protocol and the wrapper-as-an-implementation cannot pass through, and we've now migrated our Claude backend to call `@anthropic-ai/claude-agent-sdk` directly. The five gaps that forced the migration:

1. **`AskUserQuestion` is hard-blocked** at the wrapper (`acp-agent.ts:1813`). Claude can never ask the user a multi-choice clarifying question through ACP.
2. **Only `PostToolUse` hooks are exposed** (`acp-agent.ts:1864-1885`). No `PreToolUse`, no `UserPromptSubmit`, no `Stop`, no `SessionStart/End`, no `SubagentStart/Stop`. A whole class of host policy/audit/UX features is unreachable.
3. **No in-process MCP server transport.** ACP forwards only `stdio | http | sse` (`acp-agent.ts:1749-1773`). For an Obsidian plugin, every vault file op needs to flow through `vault.adapter` (so sync, frontmatter, plugin events fire). Under ACP we'd have to spawn a localhost MCP subprocess that round-trips back into the renderer per call — defeats the point.
4. **Many SDK system & content events are silently dropped** (`acp-agent.ts:837-852, 1132-1136, 2738-2747`). Compaction, task progress, memory recall, rate-limit, redacted thinking, `input_json_delta`, citations — all gone. Hosts cannot show "context compacted" UI, live tool-input typing, structured citations, or backoff state.
5. **Streaming model collapses too early.** Tool inputs only arrive as completed JSON blocks (`input_json_delta` discarded); thinking surfaces only as plain text (`acp-agent.ts:2576-2585`); subagent runs surface only as flat `tool_call`s tagged with `parent_tool_use_id`.

The rest of this doc walks each gap with code citations on both sides — so each section can be lifted into a tracked issue. A prioritized list lives in §5. We also call out what ACP got right in §4; the protocol's session-update streaming and `requestPermission` shapes are genuinely good, just under-expressive at the edges.

All ACP-side citations refer to `@agentclientprotocol/claude-agent-acp` v0.31.4 (`~/Developer/claude-agent-acp/src/`). All host-side citations refer to obsidian-copilot branch `zero/acp-test`.

---

## 2. How we use the protocol

Our host:

- Is an Obsidian plugin running inside an Electron renderer (no Node CLI shell, no easy access to spawn pipes from the renderer).
- Drives **multiple agent backends** behind a single UI: Claude (now via SDK), OpenCode (ACP), Codex (ACP). The multi-backend story is exactly why ACP is valuable to us — and exactly why we're writing this rather than walking away.
- Operates on **vault files**, not OS files. Every file mutation must go through `vault.adapter` / `vault.modify` to keep Obsidian's sync, frontmatter parsing, plugin event bus, and encryption-at-rest providers consistent. Direct FS writes are observable but lossy.
- Streams to a custom React UI that wants to render: live thinking deltas, live tool-input deltas, plan proposals, multi-choice elicitation modals, per-turn cost, compaction notices, and rate-limit backoff.
- Targets desktop and mobile Obsidian. Mobile has no `claude` CLI binary available; we work around this only on desktop today.

---

## 3. Limitations by category

Each subsection follows the same shape:

> **What ACP / claude-agent-acp does today** — with `path:line` citation.
> **What we needed** — concrete UX example.
> **Workaround attempted under ACP** — or "no workaround possible."
> **What the SDK exposes natively** — with citation.
> **Suggested protocol change** — one line the ACP team can act on.

### 3.1 No `AskUserQuestion` — agent cannot ask multi-choice clarifying questions

**ACP today.** The wrapper hard-codes `AskUserQuestion` into a disallowed-tools list:

```ts
// claude-agent-acp/src/acp-agent.ts:1812-1813
// Disable this for now, not a great way to expose this over ACP at the moment
// (in progress work so we can revisit)
const disallowedTools = ["AskUserQuestion"];
```

That list is then merged into the SDK options unconditionally (`acp-agent.ts:1862`). There is no `_meta` opt-in, no client capability flag, no way for a host that _does_ know how to render multi-choice prompts to receive them.

**What we needed.** When a user types "rename the daily note", Claude should be able to ask "Which one — today's, yesterday's, or both?" with three buttons, get back the user's selection, and continue the turn without having to abandon and re-prompt.

**Workaround under ACP.** None. The tool is gone from Claude's tool list before the prompt even starts. There is no equivalent ACP notification (`session/elicitation`, `session/ask_question`, etc.).

**SDK native.** The SDK ships `AskUserQuestion` as a built-in tool whose dispatch flows through `canUseTool`. Our `permissionBridge.ts` intercepts:

```ts
// obsidian-copilot/src/agentMode/sdk/permissionBridge.ts
if (toolName === "AskUserQuestion") {
  const answers = await openAskUserQuestionModal(input.questions);
  return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
}
```

The host opens the modal, the user clicks, the answers thread back through `updatedInput`, and the agent continues the same turn. No protocol-level gymnastics required.

**Suggested protocol change.** Add a `session/elicitation` notification with structured options:

```jsonc
{
  "method": "session/elicitation",
  "params": {
    "sessionId": "…",
    "questions": [
      {
        "question": "Which note?",
        "header": "note-pick",
        "options": [
          { "label": "Today", "description": "2026-05-03.md" },
          { "label": "Yesterday", "description": "2026-05-02.md" },
        ],
        "multiSelect": false,
      },
    ],
  },
}
```

Client returns answers in the response. Hosts that don't implement it can advertise so via capability and the wrapper falls back to the current "disallowed" behavior.

---

### 3.2 Hooks: only `PostToolUse` is exposed

**ACP today.** The wrapper hard-wires exactly one hook surface and uses it internally:

```ts
// claude-agent-acp/src/acp-agent.ts:1864-1885
hooks: {
  ...userProvidedOptions?.hooks,
  PostToolUse: [
    ...(userProvidedOptions?.hooks?.PostToolUse || []),
    {
      hooks: [
        createPostToolUseHook(this.logger, {
          onEnterPlanMode: async () => {
            await this.client.sessionUpdate({
              sessionId,
              update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
            });
            await this.updateConfigOption(sessionId, "mode", "plan");
          },
        }),
      ],
    },
  ],
},
```

User-provided `hooks.PreToolUse`, `hooks.UserPromptSubmit`, `hooks.Stop`, `hooks.SessionStart`, `hooks.SessionEnd`, `hooks.SubagentStart`, `hooks.SubagentStop`, `hooks.PermissionRequest` etc. are silently passed into `userProvidedOptions?.hooks` only if the _caller_ is a Node consumer that already has SDK types — which an ACP client by construction is not. Across the wire, ACP has no hook concept at all.

The SDK-side hook lifecycle events that _do_ fire (`hook_started`, `hook_progress`, `hook_response`) are then explicitly dropped:

```ts
// claude-agent-acp/src/acp-agent.ts:837-839
case "hook_started":
case "hook_progress":
case "hook_response":
```

(Falls through to the no-op default; cf. lines 837-852.)

**What we needed.**

- **`PreToolUse`** to gate destructive vault writes against a per-vault audit policy _before_ the tool runs (so a denial prevents partial state).
- **`UserPromptSubmit`** to inject vault-context (current note title, selection, frontmatter) into every prompt without polluting the system prompt.
- **`Stop`** to flush a turn-end event for our chat persistence layer.
- **`SubagentStart/Stop`** to render a hierarchical run tree in the UI.

**Workaround under ACP.** Partial. The wrapper's own `PostToolUse` handler emits `current_mode_update` for `EnterPlanMode` and forwards Edit-tool diffs (`tools.ts:771-798`), but this is a private side channel; we cannot intercept it. For `PreToolUse` we'd have to abuse `requestPermission` (which only fires for tools that require approval — read-only tools never hit it).

**SDK native.** Full hook surface across the SDK's `Hook` lifecycle. We don't yet use all of them in obsidian-copilot, but the migration _unblocks_ them:

```ts
// (planned) src/agentMode/sdk/ClaudeSdkBackendProcess.ts
hooks: {
  PreToolUse: [{ hooks: [auditWriteHook] }],
  UserPromptSubmit: [{ hooks: [vaultContextInjector] }],
  Stop: [{ hooks: [persistTurnHook] }],
}
```

**Suggested protocol change.** Add a `session/hook_event` notification with `phase: "pre_tool_use" | "post_tool_use" | "user_prompt_submit" | "stop" | "session_start" | "session_end" | "subagent_start" | "subagent_stop" | "permission_request"` and an opaque `payload` blob. Clients that handle it can return a hook _response_ (block / modify / continue) via the response object. Wrappers stay free to map this onto whatever native hook system the underlying agent has.

---

### 3.3 No in-process MCP servers

**ACP today.** ACP's MCP forwarding accepts exactly three transport types:

```ts
// claude-agent-acp/src/acp-agent.ts:1749-1773
const mcpServers: Record<string, McpServerConfig> = {};
if (Array.isArray(params.mcpServers)) {
  for (const server of params.mcpServers) {
    if ("type" in server && (server.type === "http" || server.type === "sse")) {
      mcpServers[server.name] = {
        type: server.type,
        url: server.url,
        headers: server.headers ? Object.fromEntries(...) : undefined,
      };
    } else {
      // Stdio type (with or without explicit type field)
      mcpServers[server.name] = {
        type: "stdio",
        command: server.command,
        args: server.args,
        env: server.env ? Object.fromEntries(...) : undefined,
      };
    }
  }
}
```

There is no fourth case for "host implements these tools in-process and the wrapper should call back via JSON-RPC."

**What we needed.** Vault file ops (`vault_read`, `vault_write`, `vault_edit`, `vault_list`, `vault_glob`, `vault_grep`) MUST flow through `app.vault.adapter` and `app.vault.modify/create`. Anything else — direct FS access from a spawned subprocess, for instance — bypasses Obsidian's:

- file-modified event bus (other plugins watching for changes break)
- frontmatter parser / metadata cache
- third-party sync drivers (Obsidian Sync, iCloud, Self-hosted LiveSync)
- mobile compatibility (mobile has no spawnable processes at all)
- vault encryption-at-rest plugins

**Workaround under ACP.** We considered shipping a localhost stdio MCP subprocess that round-trips every read/write back into the renderer over WebSocket or named pipe. This (a) cannot work on mobile, (b) requires shipping platform-specific binaries inside an Obsidian plugin, which is not a supported distribution shape, and (c) adds a per-tool-call latency floor for what should be a memory-speed operation.

**SDK native.** The SDK accepts an `sdk`-typed MCP server whose tools are JS callbacks the agent invokes in-process:

```ts
// obsidian-copilot/src/agentMode/sdk/vaultMcpServer.ts
const server = createSdkMcpServer({
  name: "obsidian-vault",
  tools: [
    tool("vault_read", "Read a vault file", { path: z.string() }, async ({ path }) => {
      return { content: [{ type: "text", text: await app.vault.adapter.read(path) }] };
    }),
    // … vault_write, vault_edit, vault_list, vault_glob, vault_grep
  ],
});

// in query options:
mcpServers: { "obsidian-vault": { type: "sdk", instance: server } }
```

The agent sees the tools as normal MCP tools; the host runs them with full vault-API access. No subprocess, no IPC, works on mobile.

**Suggested protocol change.** Add an `mcp/sdk` (or `mcp/host`) transport. The wrapper-side adapter would expose the tools as if they were stdio MCP, but route every `tools/call` back to the ACP client as a `session/host_tool_call` notification, awaiting a response. Implementation cost on both sides is moderate; the payoff is hosts can finally implement their own first-class tools without process management.

---

### 3.4 Silent message drops

**ACP today.** Two large switch statements in `acp-agent.ts` and `tools.ts` enumerate SDK events the wrapper does not translate. Falling through means the host literally never sees them.

System messages (`acp-agent.ts:837-852`):

```ts
case "hook_started":
case "hook_progress":
case "hook_response":
case "files_persisted":
case "task_started":
case "task_notification":
case "task_progress":
case "task_updated":
case "elicitation_complete":
case "plugin_install":
case "memory_recall":
case "notification":
case "api_retry":
case "mirror_error":
```

Tool-progress / auth / billing (`acp-agent.ts:1132-1136`):

```ts
case "tool_progress":
case "tool_use_summary":
case "auth_status":
case "prompt_suggestion":
case "rate_limit_event":
```

Content block types (`acp-agent.ts:2738-2747`):

```ts
case "document":
case "search_result":
case "redacted_thinking":
case "input_json_delta":
case "citations_delta":
case "signature_delta":
case "container_upload":
case "compaction":
case "compaction_delta":
case "advisor_tool_result":
  break;
```

**What we needed (host-by-host UX impact).**

| Dropped event                                                        | UX we wanted but cannot ship                                                                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `compaction`, `compaction_delta`                                     | Show "Context window compacted (X→Y tokens)" notice in chat history so users understand why earlier messages stop influencing the model |
| `task_started`, `task_progress`, `task_updated`, `task_notification` | Render running subagents with live progress; show their tools/output without polling                                                    |
| `memory_recall`                                                      | Surface "Agent recalled this from session 2026-04-12" as inline citation                                                                |
| `redacted_thinking`                                                  | Show a redaction marker (current behavior: thinking just silently disappears)                                                           |
| `input_json_delta`                                                   | Live "Bash command being typed" in tool-call UI (see §3.6)                                                                              |
| `citations_delta`                                                    | Structured citations from `WebSearch` / `WebFetch` results — currently lost and re-derived from text                                    |
| `signature_delta`                                                    | Cryptographic signing of thinking blocks (used for cache-eligibility) — required for cache semantics in extended-thinking turns         |
| `rate_limit_event`, `api_retry`                                      | Show "Rate-limited, retrying in 12s" UI; today the user just sees an unexplained stall                                                  |
| `auth_status`                                                        | React to mid-turn auth-token refresh failures                                                                                           |
| `tool_progress`                                                      | Long-running tool progress bars (Bash, WebFetch with large responses)                                                                   |

**Workaround under ACP.** None. The events do not cross the wire.

**SDK native.** All the above events are first-class on `SDKMessage` / `stream_event`. The host can subscribe selectively.

**Suggested protocol change.** Two-part fix:

1. **Add explicit variants** for the high-value ones (`session/compaction`, `session/task_progress`, `session/rate_limit`, `session/citation`).
2. **Add a passthrough envelope** `session/raw_event` with `{ source: "claude_code" | "opencode" | …, eventType: string, payload: unknown }` for everything else, behind a client capability flag. Hosts that opt in get to render whatever they want; hosts that don't get current behavior.

---

### 3.5 Information flattening on tool calls

**ACP today.** The wrapper recognizes 8 named tools (Agent/Task, Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch — `tools.ts:121-411`) and collapses everything else into `kind: "other"` with the input JSON-stringified.

```ts
// claude-agent-acp/src/tools.ts:121-145 (excerpt)
export function toolInfoFromToolUse(
  toolUse: any,
  supportsTerminalOutput = false,
  cwd?: string
): ToolInfo {
  const name = toolUse.name;
  switch (name) {
    case "Agent":
    case "Task": {
      /* kind: "think" */
    }
    case "Bash": {
      /* kind: "execute" */
    }
    case "Read": {
      /* kind: "read" */
    }
    case "Write":
    case "Edit": {
      /* kind: "edit" */
    }
    case "Glob":
    case "Grep": {
      /* kind: "search" */
    }
    case "WebFetch":
    case "WebSearch": {
      /* kind: "fetch" */
    }
    // … TodoWrite (special-cased to plan update), ExitPlanMode (switch_mode)
    default:
      return {
        title: name,
        kind: "other",
        content: [
          {
            type: "content",
            content: { type: "text", text: JSON.stringify(toolUse.input, null, 2) },
          },
        ],
      };
  }
}
```

`Edit` and `Write` results are translated to **empty** updates, with the actual diff smuggled through the `PostToolUse` hook side channel (`tools.ts:413-552`):

```ts
case "Edit":
case "Write":
  // diffs are sent via PostToolUse hook only
  return {};
```

Image content in tool results is downconverted to a text stub (`tools.ts:632`):

```ts
return [{ type: "content", content: { type: "text", text: `Fetched: ${block.url ?? ""}` } }];
```

**What we needed.** Any user-defined MCP tool — say a `notion_search` tool from a Notion MCP server — should render with a meaningful icon and title, not "Other: { query: 'foo' }". And any tool whose result is an image (a chart-rendering MCP tool, an OCR tool) should keep the image.

**Workaround under ACP.** None for non-builtin tools. For the image case, only inline base64 images survive the round-trip; URL- and file-based images become text.

**SDK native.** Tool results carry full `content` arrays through unchanged. MCP tools advertise their own metadata (description, inputSchema, annotations) at registration; hosts that consume the SDK directly can read the registry.

**Suggested protocol change.** Add a `tool_call.metadata` field populated from MCP tool descriptors at registration time:

```jsonc
{
  "sessionUpdate": "tool_call",
  "toolCallId": "…",
  "title": "notion_search",
  "kind": "search",
  "metadata": {
    "mcpServer": "notion",
    "description": "Search Notion pages",
    "icon": "notion",
  },
  "rawInput": { "query": "foo" },
}
```

Plus: stop dropping image content blocks unconditionally — pass them through with their original `source` shape (URL / file / base64) and let the host decide.

---

### 3.6 Streaming model: no partial tool inputs, no thinking deltas

**ACP today.** Two specific deltas are silently dropped on the content-block level (`acp-agent.ts:2738-2747`, repeated for emphasis):

- `input_json_delta` — the SDK streams tool-call arguments incrementally. ACP discards.
- `signature_delta` — used to sign thinking blocks for cache eligibility. ACP discards.

Thinking blocks themselves _do_ survive but only as plain text (`acp-agent.ts:2576-2585`):

```ts
// excerpt — every thinking block becomes a flat agent_thought_chunk
case "thinking":
case "thinking_delta":
  update = { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: block.text ?? block.delta } };
```

Structured budget, signature, encrypted-thinking metadata — all lost.

**What we needed.**

- Live tool-input UI: as Claude types out a Bash command, show it filling in token-by-token. Not just "spinner → completed JSON dump."
- Cacheable thinking turns: keep the signature so the next turn can re-use the cache.
- Thinking metadata UI: render budget consumed / remaining as a progress bar.

**Workaround under ACP.** The wrapper _does_ call `toAcpNotifications` recursively on a streaming `content_block_start` (`acp-agent.ts:2784-2790`), which means the _first_ time a `tool_use` block opens we get a `tool_call` notification — but its `input` field is the empty object the SDK started with, since `input_json_delta` updates between `start` and `stop` are not propagated. We can't reconstruct progressive input client-side.

**SDK native.** Full `stream_event` access including `input_json_delta`, `signature_delta`, `text_delta`, `thinking_delta`. Our translator now reassembles per content-block index:

```ts
// obsidian-copilot/src/agentMode/sdk/sdkMessageTranslator.ts
case "input_json_delta": {
  const block = state.toolUseBlocks.get(event.index);
  if (!block) break;
  block.partial += event.delta.partial_json;
  try {
    block.parsed = parsePartialJson(block.partial);
  } catch { /* still incomplete */ }
  emit({ sessionUpdate: "tool_call_update", toolCallId: block.id, rawInput: block.parsed });
}
```

The UI shows the Bash command typing itself in.

**Suggested protocol change.** Add two notification variants:

- `tool_call_input_chunk { toolCallId, partialInputJson }` — fired as each `input_json_delta` arrives. Hosts can either ignore (current behavior) or use it to drive live UI.
- `agent_thought_chunk` already exists; extend with optional `signature?: string`, `budgetTokensUsed?: number`, `budgetTokensRemaining?: number` fields.

---

### 3.7 No fine-grained permission control

**ACP today.** The wrapper exposes exactly three session config options (`acp-agent.ts:2256-2339`): `mode`, `model`, `effort`. The `mode` enum (`acp-agent.ts:1319-1324`) covers `auto | default | acceptEdits | bypassPermissions | dontAsk | plan`. There is no separate axis for `permissionMode` — the two are conflated.

`requestPermission` outcomes are limited to:

- `allow_once`
- `allow_always` with a label string ("all Bash", "Bash(npm test:\*)")
- `reject_once`

**What we needed.**

- The SDK's `canUseTool` callback can return `updatedPermissions: PermissionUpdate[]` along with the decision — a structured array of allow/deny rules to install for the rest of the session. Far richer than a label string.
- Independent `permissionMode` (gates whether tools require approval) and "agent mode" (e.g. `plan` is conceptually different from `acceptEdits`).

**Workaround under ACP.** We parse the `allow_always` label heuristically to derive "always allow Bash with prefix `npm test`" rules. Brittle and lossy — the label is human text, not a structured rule.

**SDK native.**

```ts
// SDK type
type PermissionResult =
  | { behavior: "allow"; updatedInput?: unknown; updatedPermissions?: PermissionUpdate[] }
  | { behavior: "deny"; reason: string };

type PermissionUpdate =
  | { type: "addRules"; rules: PermissionRule[]; behavior: "allow" | "deny" | "ask"; destination: "session" | "project" | "user" }
  | { type: "removeRules"; rules: PermissionRule[]; … }
  | { type: "setMode"; mode: PermissionMode; … };
```

**Suggested protocol change.** Extend the `session/request_permission` response schema with an optional `updatedPermissions: PermissionUpdate[]` array using a structured rule shape rather than a free-form label.

---

### 3.8 Session control plane is RPC-only, not live

**ACP today.** Switching model or mode mid-session is a separate RPC roundtrip:

- `session/set_session_model`
- `session/set_session_config_option` (for `mode` / `effort`)

Plus capability probing — the wrapper detects whether the agent supports them at all (the obsidian-copilot side handles the probe in `src/agentMode/acp/AcpBackendProcess.ts:96-101`).

**What we needed.** A user is mid-turn on Sonnet, sees Claude is going to need a long thinking pass, and wants to switch to Opus _without_ aborting and re-prompting (which would discard the partial output and lose the cache).

**Workaround under ACP.** Abort the turn (`session/cancel`), wait for the cancel to settle, send `session/set_session_model`, re-prompt with the original user input. User sees their progress disappear and a fresh latency cost.

**SDK native.** The SDK's `query()` exposes async `setModel(modelId)` and `setPermissionMode(mode)` methods callable mid-stream. Internally these flow through the same JSON-RPC framing, but they're applied to the _live_ generator without interrupting it. Our adapter forces streaming-input mode (`ClaudeSdkBackendProcess.ts:218`) to enable this.

```ts
// obsidian-copilot/src/agentMode/sdk/ClaudeSdkBackendProcess.ts:330-360
async setModel(model: string) {
  await this.activeQuery?.setModel(model);
}
async setPermissionMode(mode: PermissionMode) {
  await this.activeQuery?.setPermissionMode(mode);
}
```

**Suggested protocol change.** Define the existing `session/set_session_model` and `session/set_session_config_option` RPCs as **valid mid-turn** (not just between turns), and require wrappers to apply them to the in-flight generator without interrupting. Document the semantics: the new value applies starting from the _next_ assistant message or tool call within the current turn.

---

### 3.9 No subagent control surface

**ACP today.** The Agent / Task tool is mapped onto `kind: "think"` (`tools.ts:129-144`):

```ts
case "Agent":
case "Task": {
  const input = toolUse.input as AgentInput | BashInput | undefined;
  return { title: input?.description ?? "Task", kind: "think", … };
}
```

Subagent runs surface as nested `tool_call` updates tagged with `_meta.claudeCode.parentToolUseId` (`acp-agent.ts:2755-2762`). There is no first-class "subagent started / progressed / finished / errored" event family.

**What we needed.**

- Render running subagents with their model, allowed tools, and cumulative token use.
- Allow the user to interrupt a specific subagent without aborting the whole turn.
- Show a hierarchical run tree (parent agent → subagent → sub-subagent) instead of a flat list of `tool_call`s.

**Workaround under ACP.** Reconstruct the tree client-side from `parent_tool_use_id`. Possible but fragile, and doesn't unlock interruption or per-subagent status.

**SDK native.** The SDK exposes `agents: { name: AgentDefinition }` config, an `Agent` tool, and `task_*` events (`task_started`, `task_progress`, `task_notification`, `task_updated`) — all of which ACP drops (§3.4).

**Suggested protocol change.** Add a `session/subagent_*` notification family:

- `session/subagent_started { taskId, parentTaskId?, name, model, tools }`
- `session/subagent_progress { taskId, message? }`
- `session/subagent_finished { taskId, status: "ok" | "error" | "cancelled", usage? }`

Plus a `session/cancel_subagent { taskId }` RPC.

---

### 3.10 System prompt locked to preset

**ACP today.** `acp-agent.ts:1775-1791` constructs the system prompt; the default and the "custom" path both keep `type: "preset"`:

```ts
let systemPrompt: Options["systemPrompt"] = { type: "preset", preset: "claude_code" };
if (params._meta?.systemPrompt) {
  const customPrompt = params._meta.systemPrompt;
  if (typeof customPrompt === "string") {
    systemPrompt = customPrompt; // raw string supported via _meta
  } else {
    systemPrompt = {
      type: "preset",
      preset: "claude_code",
      append: customPrompt.append,
      // …
    } as Options["systemPrompt"];
  }
}
```

So a host _can_ fully override by passing a raw string via `_meta.claudeCode.systemPrompt`, but the only documented protocol-level way to customize is append-style on top of the locked `claude_code` preset.

**What we needed.** Insert vault-specific scaffolding ("paths are vault-relative; never use absolute FS paths; the user's current note is X; selection is Y") _without_ the Claude Code preset clobbering it. The Claude Code preset assumes a CLI environment, references `.claude/` files, and instructs about behaviors that don't apply inside Obsidian.

**Workaround under ACP.** Use `_meta.claudeCode.systemPrompt` as a string. Works, but is an undocumented escape hatch and reaches outside the protocol contract — not portable to non-Claude ACP backends.

**SDK native.** `systemPrompt: string` is fully supported as a first-class field on `Options`.

**Suggested protocol change.** Promote `systemPrompt` to a documented protocol-level field on `session/new` with two shapes:

```ts
type SystemPrompt =
  | { type: "preset"; preset: string; append?: string; excludeDynamicSections?: string[] }
  | { type: "custom"; text: string };
```

Wrappers translate to whatever the underlying agent supports; agents that only have presets can refuse `type: "custom"` with a clear error.

---

### 3.11 Slash command / skill allowlist filtering

**ACP today.** The wrapper hard-codes a list of slash commands that are stripped before being advertised to the client (`acp-agent.ts:2379-2410`):

```ts
const UNSUPPORTED_COMMANDS = [
  "cost",
  "keybindings-help",
  "login",
  "logout",
  "output-style:new",
  "release-notes",
  "todos",
];
```

Plus MCP commands get renamed: `/mcp:server:cmd` → `/server:cmd (MCP)`.

**What we needed.** Some of these we'd actually like to surface — `/cost` could populate our settings panel, `/release-notes` could show a changelog. We have a different login flow, so `/login` and `/logout` can stay filtered, but that should be a host _choice_, not a wrapper _fact_.

**Workaround under ACP.** None. The wrapper strips them before they reach us.

**SDK native.** `query.supportedCommands()` returns the full list with metadata; the host filters as it sees fit.

**Suggested protocol change.** Pass through all commands by default. Let the host opt out via capability:

```jsonc
{
  "clientCapabilities": {
    "slashCommands": { "exclude": ["login", "logout"] },
  },
}
```

---

### 3.12 Auth and CLI binary discovery (wrapper, not protocol)

These aren't ACP-protocol issues per se, but anyone consuming `claude-agent-acp` from a non-Node-CLI environment hits them:

- **Binary discovery.** The wrapper calls `claudeCliPath()` (`acp-agent.ts:1857`) which assumes a normal `PATH` environment. Inside Obsidian / Electron renderer, `PATH` doesn't include user shell paths; we had to ship a `claudeBinaryResolver` (in `obsidian-copilot/src/agentMode/sdk/`) that probes Volta, asdf, NVM, Homebrew, npm-global, and Windows-specific locations.
- **Electron renderer crashes.** Both the SDK's process-transport-close and the MCP SDK's stdio-close-wait call `.unref()` on a `setTimeout` handle. In the Electron renderer this is unsafe and crashes during teardown. We patch this at bundle time with `scripts/patchRendererUnsafeUnref.js`. The wrapper inherits this directly from the SDK — same patch would be needed for any host that bundles `claude-agent-acp` into a renderer.
- **Mobile.** No spawnable binaries. The wrapper has no escape hatch for "no CLI available, fall back to remote API."

**Suggested protocol change / wrapper change.**

1. Document the binary-discovery contract (wrapper reads `CLAUDE_CODE_EXECUTABLE`; if unset, calls `claudeCliPath()`; recommended host behavior is to set the env var explicitly).
2. Ship a renderer-safe build of the wrapper (or guard the unsafe `.unref()` sites internally).
3. (Long-term) Add a `mode: "remote" | "local"` option that routes through the Anthropic API directly when no local binary is available — useful for mobile and serverless hosts.

---

## 4. What ACP got right

It's worth stating clearly: the protocol's bones are good, and the gaps above are fixable without breaking the abstraction.

- **Session-update streaming** (`SessionNotification` + `sessionUpdate` discriminator) is the right shape for tail-of-turn events. Adding new variants is non-breaking.
- **`requestPermission`** has the right semantics — synchronous client decision blocking the agent. The under-expressiveness (§3.7) is an extension point, not a redesign.
- **Multi-backend uniformity** is the actual reason we wrote this letter rather than walking away. Our OpenCode and Codex backends still go through ACP, and the win of "one UI, one chat-history layer, one permission modal across three different agents" is large enough that we tolerated each gap individually for a long time. We're not asking for ACP to absorb every Claude-specific feature — we're asking for the protocol to grow generic versions of the categories the SDK has shown to be valuable.

---

## 5. Prioritized request list

| Priority    | Gap                                                                                                                                                 | Section |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **P0**      | `AskUserQuestion` / structured elicitation                                                                                                          | §3.1    |
| **P0**      | Hook lifecycle events (`PreToolUse`, `UserPromptSubmit`, `Stop`, `Subagent*`, `SessionStart/End`)                                                   | §3.2    |
| **P0**      | In-process MCP transport (`mcp/sdk` or `mcp/host`)                                                                                                  | §3.3    |
| **P1**      | Pass through dropped events: `compaction`, `task_*`, `memory_recall`, `rate_limit_event`, `redacted_thinking`, `citations_delta`, `signature_delta` | §3.4    |
| **P1**      | Streaming tool input deltas (`tool_call_input_chunk`)                                                                                               | §3.6    |
| **P1**      | Structured `updatedPermissions` array on `requestPermission` response                                                                               | §3.7    |
| **P2**      | Documented custom system prompt (`type: "custom"`)                                                                                                  | §3.10   |
| **P2**      | First-class subagent notifications                                                                                                                  | §3.9    |
| **P2**      | Mid-turn model / mode / config switches applied to live generator                                                                                   | §3.8    |
| **P3**      | Slash command passthrough by default                                                                                                                | §3.11   |
| **P3**      | `tool_call.metadata` for non-builtin tools + image content preservation                                                                             | §3.5    |
| **Wrapper** | Renderer-safe build, documented binary discovery, mobile/remote escape hatch                                                                        | §3.12   |

---

## 6. Appendix

### 6.1 Citation index (ACP wrapper)

- `acp-agent.ts:837-852` — system message switch dropping `hook_*`, `task_*`, `files_persisted`, `elicitation_complete`, `plugin_install`, `memory_recall`, `notification`, `api_retry`, `mirror_error`
- `acp-agent.ts:1132-1136` — `tool_progress`, `tool_use_summary`, `auth_status`, `prompt_suggestion`, `rate_limit_event` dropped
- `acp-agent.ts:1319-1324` — `mode` enum: `auto`, `default`, `acceptEdits`, `bypassPermissions`, `dontAsk`, `plan`
- `acp-agent.ts:1749-1773` — MCP transport handling (stdio / http / sse only)
- `acp-agent.ts:1775-1791` — system prompt construction (locked to preset over the wire)
- `acp-agent.ts:1812-1813` — `disallowedTools = ["AskUserQuestion"]`
- `acp-agent.ts:1864-1885` — hook config (PostToolUse only; internal `onEnterPlanMode`)
- `acp-agent.ts:2256-2339` — exposed config options (mode, model, effort)
- `acp-agent.ts:2379-2410` — `UNSUPPORTED_COMMANDS` slash-command filter
- `acp-agent.ts:2576-2585` — thinking blocks → flat `agent_thought_chunk`
- `acp-agent.ts:2738-2747` — content block types dropped
- `acp-agent.ts:2755-2762` — subagent surface via `_meta.claudeCode.parentToolUseId`
- `tools.ts:121-411` — 8-tool kind allowlist
- `tools.ts:413-552` — Edit/Write tool result transforms (returns `{}`)
- `tools.ts:632` — image content downconverted to `"Fetched: <url>"` text stub
- `tools.ts:771-798` — internal PostToolUse hook for plan-mode and Edit-diff propagation

### 6.2 Citation index (host adapter that demonstrates the SDK surface)

- `obsidian-copilot/src/agentMode/sdk/ClaudeSdkBackendProcess.ts` — query lifecycle, mid-turn `setModel`/`setPermissionMode`, MCP server registration
- `obsidian-copilot/src/agentMode/sdk/sdkMessageTranslator.ts` — `input_json_delta` reassembly, thinking-delta handling, `EnterPlanMode` detection
- `obsidian-copilot/src/agentMode/sdk/vaultMcpServer.ts` — in-process MCP server using `vault.adapter`
- `obsidian-copilot/src/agentMode/sdk/permissionBridge.ts` — `canUseTool` integration, AskUserQuestion modal hookup
- `obsidian-copilot/src/agentMode/acp/AcpBackendProcess.ts` — the ACP integration we kept for OpenCode and Codex

### 6.3 Versions tested

- `@agentclientprotocol/claude-agent-acp` v0.31.4
- `@anthropic-ai/claude-agent-sdk` v0.2.123 (the version `claude-agent-acp` itself depends on)
- `@agentclientprotocol/sdk` v0.21.0

### 6.4 Cross-reference

Internal migration roadmap: [`designdocs/todo/CLAUDE_AGENT_SDK_MIGRATION.md`](./todo/CLAUDE_AGENT_SDK_MIGRATION.md). That document covers our implementation plan, milestones, and Electron-renderer spike findings — this document is its outward-facing protocol-feedback companion.

---

_We're happy to chat through any of these in more detail, contribute fixes upstream, or test pre-release wrapper changes against our codebase. The fastest channel for follow-ups is the obsidian-copilot GitHub issues; tag them `acp-feedback`._
