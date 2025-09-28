# 6) Functional Requirements

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
