# PRD — Parallel Tool Execution (Brownfield: Service/API) — v0.2

Date: 2025-09-27

## 0) Change Log

| Date       | Ver | Author | Notes                                  |
| ---------- | --- | ------ | -------------------------------------- |
| 2025-09-27 | 0.2 | PM     | Update after document-project baseline |
| 2025-09-27 | 0.1 | PM     | Initial draft                          |

## 1) Background (Baseline Reference)

This PRD supersedes v0.1 using findings from `document-project.md` (baseline). Baseline confirms:

- Sequential tool execution per turn.
- Downstream assumes ordered results aligned to input indices.
- XML `<use_tool>` protocol and streaming delimiters (`</use_tool>`) are stable contracts.
- Background tools emit no UI markers.
- Timeouts and Plus gating live in the execution utility.

### System Overview (from baseline)

- **Domain:** Obsidian Copilot agentic runtime with tool calls emitted via textual XML blocks `<use_tool>…</use_tool>` embedded in assistant output.
- **Runners:**
  - `AutonomousAgentChainRunner` — drives autonomous tool-using loops.
  - `CopilotPlusChainRunner` — prepares pre‑chat context and orchestrates Copilot Plus tools.
- **Tool Execution Utility:** `toolExecution.ts` centralizes validation, Plus gating, and timeout control.
- **Streaming & Truncation:** `ThinkBlockStreamer` scans for closing `</use_tool>` tags to delineate tool blocks for UI streaming.
- **Post‑processing:** `processToolResults` in `toolResultUtils.ts` merges ordered tool outputs into the assistant’s next message, memory, and user‑facing tool‑result payloads.

> Baseline behavior: **sequential execution** of tool calls per turn. Results are consumed in **input order**. Banners/markers reflect start → complete per tool.

## 2) Problem Statement

Sequential execution inflates wall-clock latency for I/O-bound turns (e.g., many web searches). We need concurrency without breaking ordered-consumer assumptions or textual protocol.

## 3) Goals

- Reduce wall time by running independent tool calls concurrently.
- Preserve contracts: XML/text protocol, deterministic ordered aggregation, existing UI marker semantics.
- Keep validation, gating, and timeout behavior unchanged.
- Safe rollout via feature flag and concurrency cap.

## 4) Out of Scope

- Any protocol change to tool-call representation or streaming.
- New tool schemas or UI redesign.
- LLM streamed tool_call delta protocol.

## 5) Users

- End users issuing multi-tool queries.
- Devs maintaining runners and execution utilities.
- QA validating parity and performance.

## 6) Functional Requirements

- **FR1**: Add `executeToolCall(call, opts)` as the single-call core used by sequential and parallel paths.
- **FR2**: Add `executeToolCallsInParallel(calls, opts)` with a concurrency cap; return results **in input order**.
- **FR3**: Hooks `onStart(index, meta)` and `onSettle(index, result)` drive current banners; skip markers for background tools.
- **FR4**: Preserve Plus gating, timeouts, and normalization by delegating to the single-call core.
- **FR5**: Autonomous runner: pre-register markers, call coordinator, update markers on settle, then pass ordered array to existing `processToolResults`.
- **FR6**: Copilot+ runner: same coordinator; keep `localSearch` post-processing and identical prompt/context formatting.
- **FR7**: Honor AbortSignal; cease UI mutations after abort while allowing in-flight calls to settle safely.
- **FR8**: Feature flag: `parallelToolCalls.enabled` (default off initially).
- **FR9**: Config key: `parallelToolCalls.concurrency` (default 4; clamp 1..10).
- **FR10**: Optional telemetry: per-tool latency, status; turn-level wall time and peak concurrency.

## 7) Non‑Functional Requirements

- **NFR1**: Protocol stability — no change to `<use_tool>` or stream markers.
- **NFR2**: Determinism — final array order equals input order.
- **NFR3**: Performance — for 10 `webSearch` calls, median wall time improves by ≥40% vs sequential in synthetic test.
- **NFR4**: Compatibility — existing tests green; new tests added without removals.
- **NFR5**: Resilience — failures/timeouts do not block other calls; aggregate status per call.
- **NFR6**: Rate‑safety — cap and optional backoff for rate-limited tools.
- **NFR7**: Observability — metrics sufficient to compare sequential vs parallel behavior.

## 8) Acceptance Criteria

- **AC1**: With flag ON, `concurrency=4`, synthetic suite of 10 webSearch calls reduces median wall time by ≥40% vs sequential; p95 improves materially.
- **AC2**: Final prompt/context strings for both runners are byte-identical to sequential given identical inputs and results.
- **AC3**: Background tools produce no markers; visible tools show start/settle updates.
- **AC4**: Timeouts and Plus gating behavior match sequential path.
- **AC5**: Aborting a turn halts further marker updates without corrupting aggregation.

## 9) Metrics

- Per-tool latency, error/timeout rates, turn wall time, peak concurrency, rate-limit events.

## 10) Rollout

1. Land coordinator + feature flag behind OFF.
2. Integrate in Autonomous, then Copilot+.
3. Enable for internal cohort with `concurrency=4`.
4. Tune cap based on telemetry.
5. Default ON once stable.

## 11) Risks & Mitigations

- UI race conditions → gate updates on `signal.aborted`; per-index serialized updates.
- Hidden order coupling → snapshot tests of assembled strings; strict index ordering.
- Rate limits → default cap=4; optional exponential backoff for marked tools.
- Tool starvation → fair queue in scheduler.

## 12) Dependencies

- None beyond existing tool framework and config system.

## 13) Test Plan

### Unit (utils)

- Ordering preserved with varied latencies.
- Timeout and error propagation identical to sequential.
- Abort stops UI hook calls.

### Integration (runners)

- 5–10 mixed tools with staggered latencies: banners update per settle; final strings identical to sequential.
- Copilot+ `localSearch` post-processing parity.

### Snapshot

- Prompt/context output byte-for-byte equality where applicable.

### Chaos

- Random failures/timeouts; verify partial success aggregation and non-blocking behavior.

## 14) Configuration

```json
{{
  "parallelToolCalls": {{
    "enabled": false,
    "concurrency": 4
  }}
}}
```

## 15) Open Questions

1. Default cap 4 or 6 for current quotas?
2. Priority scheduling for visible vs background tools?
3. Telemetry sink: integrate with existing dashboards?
