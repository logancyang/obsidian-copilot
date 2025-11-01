# Deprecating `IntentAnalyzer` and Broca

This document captures the current responsibilities of the Copilot Plus intent analysis flow (`IntentAnalyzer` + Brevilabs “broca” API) and outlines a safe migration path to remove it while keeping Copilot Plus functionality aligned with the autonomous agent experience.

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
- **Implicit license enforcement**: `/broca` is the only per-turn API call guaranteed to touch Brevilabs. Although license validation also uses `/license` (`checkIsPlusUser`), Broca acts as the continuous touch point that can detect expired keys mid-session.

## Known Consumers and Side Effects

- `CopilotPlusChainRunner.run` (`src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts:488`) is the sole caller of `IntentAnalyzer.analyzeIntent`.
- `BrevilabsClient` exposes `broca` and `/license` validation; multiple subsystems already call `validateLicenseKey` directly (e.g., `checkIsPlusUser`, `embeddingManager`, `plusUtils`).
- Tests: there is no direct unit test coverage for `IntentAnalyzer`, but tool execution tests (`src/LLMProviders/chainRunner/utils/toolExecution.test.ts`) rely on the same registry.
- Production telemetry/debug logging assumes the Broca payload; removal must not break logging expectations.

## Constraints for Migration

- **Feature parity**: Copilot Plus must keep working with vault search, timeline questions, web search, file tree lookup, and memory updates.
- **License verification**: every chat turn must continue to check Plus eligibility (either by retaining a per-turn Brevilabs call or by adding an explicit `/license` check with caching and backoff).
- **Minimal prompt drift**: Copilot Plus prompts currently do not include the aggressive tool-calling instructions used by the autonomous agent; the migration should not break existing prompt tuning until the replacement strategy is ready.
- **Zero regression for `@` commands**: the existing inline overrides are user-facing affordances.
- **Search recall**: any solution must surface the same or better salient term quality as the agent chain to avoid regressions highlighted in recent investigations.
- **Plus/agent parity**: after migration, the Plus chain must feed the vault search pipeline with the same query string, expanded variants, and salient term list that the agent chain would generate for the identical user input.
- **Scoped automatic detection**: only the utility tools without explicit UI affordances (`getCurrentTime`, `convertTimeBetweenTimezones`, `getTimeRangeMs`, `getTimeInfoByEpoch`, `getFileTree`) need automatic invocation; everything else can be triggered through toggles or `@tool` commands.

## Migration Plan

### Phase 0 – Discovery & Telemetry

1. **Instrument current intent decisions**: add temporary logging (behind debug flag) to record Broca output, executed tools, and overrides. Purpose: baseline behavior before refactor.
2. **Map tool usage**: capture how frequently each Broca tool is invoked to prioritise feature parity work.
3. **Clarify license expectations**: confirm with product whether `/license` checks can replace Broca for per-turn validation, or if a lighter “heartbeat” endpoint is needed.

### Phase 1 – Surface-Agnostic Tool Planning

4. **Extract shared tool planner interface**: design a new planner (e.g., `PlusToolPlanner`) that returns the same `{ tool, args }[]` shape as `IntentAnalyzer`. Plan for multiple implementations (Broca, agent-driven, heuristic).
5. **Port `@` command handling**: move `processAtCommands` logic into the new planner so overrides are planner-agnostic.
6. **Adopt agent-style salient term generation**: introduce a reusable salience extractor (likely the agent instruction set or a deterministic tokenizer) so Plus mode produces the same salient terms the agent chain would compute.
7. **Define utility auto-detection rules**: implement deterministic heuristics for the remaining auto-triggered tools (time/time-range/time-info/file-tree) so the planner can schedule them without LLM help.

### Phase 2 – Replace Broca for Tool Scheduling

8. **Reuse ModelAdapter-driven planning**: embed a constrained agent loop (single-iteration tool planner) that leverages the existing XML instructions used by autonomous agent models. Limit to deciding tool calls; keep Copilot Plus response streaming as-is.
9. **Fallback heuristics**: provide deterministic patterns for the utility tools to guard against planner failures and avoid unneeded LLM calls for searches already controlled by UI toggles.
10. **Feature flag & dogfood**: gate the new planner behind a runtime toggle (`settings.debugPlanner` or remote flag) to test against Broca in parallel, and compare Plus/agent query-expansion outputs in telemetry to ensure they match.

### Phase 3 – License Enforcement Replacement

11. **Introduce explicit per-turn license check**: call `validateLicenseKey` (or a new lightweight endpoint) at the start of each Plus turn. Cache results for the current conversation with TTL to avoid redundant traffic within a single turn.
12. **Graceful degradation**: if validation fails or is unreachable, surface the same error handling as today (e.g., show invalid key notice, disable Plus features).

### Phase 4 – Removal & Cleanup

13. **Switch default planner**: once the new planner reaches parity, flip the feature flag so Copilot Plus no longer calls Broca. Keep Broca behind a hidden fallback flag for one release.
14. **Delete `IntentAnalyzer`**: remove the class, its tests, and references. Update imports (`initializeBuiltinTools` already handles tool registration outside IntentAnalyzer).
15. **Retire `BrevilabsClient.broca`**: delete the method and any unused types. Keep `/license` and other endpoints.
16. **Documentation & migration notes**: update `AGENTS.md`, `TODO.md`, and any user-facing Plus documentation to note the new flow.

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
