# Deprecating `IntentAnalyzer` and Broca

This document captures the current responsibilities of the Copilot Plus intent analysis flow (`IntentAnalyzer` + Brevilabs “broca” API) and outlines a safe migration path to remove it while keeping Copilot Plus functionality aligned with the autonomous agent experience. The end state is simple: the user-facing chat model (same family as the agent chain) owns tool planning, salient term extraction, and time-expression handling; Broca is fully removed.

## Current Responsibilities

- **Tool orchestration via Broca** (`src/LLMProviders/intentAnalyzer.ts:34`\
  – `BrevilabsClient.broca`): each chat turn sends the raw user message to `/broca` and receives:
  - `tool_calls`: predefined tool names with argument payloads. In practice the only tools that still rely on Broca for automatic detection are the _utility tools_ (`getCurrentTime`, `convertTimeBetweenTimezones`, `getTimeRangeMs`, `getTimeInfoByEpoch`, and occasionally `getFileTree`). Feature toggles, explicit UI controls, and `@` commands already cover search, web search, composer, memory updates, and indexing.
  - `salience_terms`: keywords Broca derives from the user message, passed untouched to the vault search tool.
- **Tool registry bootstrap** (`IntentAnalyzer.initTools`): wires up the same Zod-described tools used by the agent (`localSearchTool`, `webSearchTool`, `getTimeRangeMs`, etc.) so Copilot Plus can execute them without the agent loop.
- **Time-expression handling**: when Broca schedules `getTimeRangeMs`, `IntentAnalyzer` executes it first and stores the returned range so the subsequent `localSearch` call includes the `timeRange`.
- **`@` command overrides** (`IntentAnalyzer.processAtCommands`): falls back to local heuristics for inline control commands even if Broca does not schedule a tool call.
  - `@vault` → forces `localSearch`.
  - `@websearch` / `@web` → forces `webSearch`.
  - `@memory` → forces `updateMemory`.
- **Plus-specific salient term injection**: any Broca `salience_terms` array is passed into `localSearch` unchanged, altering recall compared with the agent chain. Our discovery shows this causes divergence between Plus and agent results; we need both flows to end up using the same salient term set.
- **Implicit license enforcement**: `/broca` is the only per-turn API call guaranteed to touch Brevilabs. Although license validation also uses `/license` (`checkIsPlusUser`), Broca acts as the continuous touch point that can detect expired keys mid-session. **Today**: `checkIsPlusUser` already runs per turn in both Copilot Plus and Autonomous Agent chain runners; keep that behavior when Broca goes away (no extra moving parts).

## Known Consumers and Side Effects

- `CopilotPlusChainRunner.run` (`src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:488`) is the sole caller of `IntentAnalyzer.analyzeIntent`.
- `BrevilabsClient` exposes `broca` and `/license` validation; multiple subsystems already call `validateLicenseKey` directly (e.g., `checkIsPlusUser`, `embeddingManager`, `plusUtils`).
- Tests: there is no direct unit test coverage for `IntentAnalyzer`, but tool execution tests (`src/LLMProviders/chainRunner/utils/toolExecution.test.ts`) rely on the same registry.
- Production telemetry/debug logging assumes the Broca payload; removal must not break logging expectations.

## Constraints for Migration

- **Feature parity**: Copilot Plus must keep working with vault search, timeline questions, web search, file tree lookup, and memory updates.
- **License verification**: every chat turn must continue to check Plus eligibility (either by retaining a per-turn Brevilabs call or by adding an explicit `/license` check with caching and backoff).
- **Minimal prompt drift**: Copilot Plus prompts currently do not include the aggressive tool-calling instructions used by the autonomous agent; the migration should not break existing prompt tuning until the replacement strategy is ready. Prefer reusing existing agent instructions instead of inventing new ones.
- **Zero regression for `@` commands**: the existing inline overrides are user-facing affordances.
- **Search recall**: any solution must surface the same or better salient term quality as the agent chain to avoid regressions highlighted in recent investigations; salient terms should come from the user chat model (agent-style extraction), not Broca.
- **Plus/agent parity**: after migration, the Plus chain must feed the vault search pipeline with the same query string, expanded variants, and salient term list that the agent chain would generate for the identical user input.
- **Scoped automatic detection**: only the utility tools without explicit UI affordances (`getCurrentTime`, `convertTimeBetweenTimezones`, `getTimeRangeMs`, `getTimeInfoByEpoch`, `getFileTree`) need automatic invocation; everything else can be triggered through toggles or `@tool` commands.
- **Self-host readiness**: future “self-host” mode must be able to (a) bypass live license checks (or use a short-lived cached verification) and (b) avoid all Brevilabs API calls while keeping the rest of the product functional, without branching code paths everywhere.

## Migration Plan

### Phase 0 – Discovery & Telemetry

1. **Instrument current intent decisions**: add temporary logging (behind debug flag) to record Broca output, executed tools, and overrides. Purpose: baseline behavior before refactor.
2. **Map tool usage**: capture how frequently each Broca tool is invoked to prioritise feature parity work.
3. **Clarify license expectations**: confirm with product whether `/license` checks can replace Broca for per-turn validation, or if a lighter “heartbeat” endpoint is needed. (Current code already calls `/license` per turn via `checkIsPlusUser`; keep this as the baseline.)

### Phase 1 – Surface-Agnostic Tool Planning

4. **Extract shared tool planner interface**: design a single planner abstraction (e.g., `PlusToolPlanner`) that returns `{ tool, args }[]`. Default implementation uses the same chat-model planning as the agent; keep Broca only as a temporary hidden fallback.
5. **Port `@` command handling**: move `processAtCommands` into the planner; keep `chatHistory` enrichment for `@websearch/@web`. One place, one behavior.
6. **Adopt agent-style salient term generation**: reuse the agent chain’s salience extraction via the chat model. Remove Broca salience entirely; no parallel salience paths.
7. **Utility auto-detection**: rely on the chat-model planner for time/time-range/time-info/file-tree, with a minimal heuristic fallback for obvious time expressions. Preserve project-mode guardrails (skip vault-level `getFileTree` in projects).

### Phase 2 – Replace Broca for Tool Scheduling

8. **Reuse ModelAdapter-driven planning**: embed a single-iteration agent-style planner that emits localSearch/webSearch/time tools with the same parameters (query + salience terms + timeRange) the agent chain would produce.
9. **Fallback heuristics**: keep deterministic fallbacks for time expressions; compute timeRange once and pass it to localSearch. Avoid extra tool calls.
10. **Feature flag & dogfood**: gate the new planner behind a toggle to compare against Broca; collect salience/time parity telemetry. Keep toggles minimal.

### Phase 3 – License Enforcement Replacement

11. **Per-turn license check**: keep the current per-turn `checkIsPlusUser` in Copilot Plus, Agent, and Projects. If you cache, cache per turn only. Centralize this so there is one path.
12. **Graceful degradation**: if validation fails or is unreachable, show the same invalid-key flow. Add a single override hook to bypass in self-host mode (no scattered flags).

### Phase 4 – Removal & Cleanup

13. **Switch default planner**: flip the feature flag when parity is reached; Broca stays as a hidden one-release fallback.
14. **Delete `IntentAnalyzer`**: remove the class, tests, and references; drop `initTools` from `src/main.ts` (tool registration already handled elsewhere).
15. **Retire `BrevilabsClient.broca`**: remove the method and unused types; keep `/license` and others.
16. **Documentation & migration notes**: update `AGENTS.md`, `TODO.md`, and user-facing Plus docs.

### Phase 5 – Prepare for Self-Host Mode

17. **Abstract Brevilabs dependencies**: one provider interface for license, web search, rerank, youtube, url/pdf ingestion. Default = Brevilabs; self-host = offline/no-op or user-supplied.
18. **Configurable license gate**: single setting for “offline verified” (short-lived cache) or “skip verification” (self-host). Copilot Plus/Projects should read from the provider, not from BrevilabsClient directly.
19. **Feature degradation without Brevilabs**: define one behavior for missing endpoints (disable specific tools or route to user-provided endpoints) without branching everywhere. Keep telemetry resilient when Broca/Brevilabs events are absent.
20. **Testing and telemetry updates**: cover provider modes (online vs self-host) and update dashboards for the absence of Broca events.

## Risks and Mitigations

- **Planner hallucination / regressions**: mitigate with deterministic overrides, strict XML parsing (already in `toolExecution`), and fallback to default responses if tool planning fails.
- **License API outages**: add retry/backoff and degrade gracefully (read-only mode, user notice).
- **Search recall differences**: unit test the new salience extractor against QueryExpander fixtures to guarantee improved recall vs Broca output and to keep Plus aligned with agent expansion behaviour.
- **Timeline for removal**: schedule the cleanup after at least one release cycle of telemetry from the new planner.

## Open Questions

- Should Copilot Plus adopt the full autonomous agent loop (multiple tool turns) or stay single-shot with a tighter planner?
- Do we need a dedicated Brevilabs endpoint for per-turn license heartbeat instead of reusing `/license`?
- How will we migrate existing analytics dashboards that currently expect Broca telemetry?

Document owner: _TBD_ (assign during implementation kickoff).
