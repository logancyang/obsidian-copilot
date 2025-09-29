# 1) Decisions (ADR)

- **ADR‑1**: Add `executeToolCall` core and `executeToolCallsInParallel` scheduler (cap default 4).
- **ADR‑2**: Preserve textual protocol and output ordering; no schema changes.
- **ADR‑3**: Runners integrate via hooks (`onStart`, `onSettle`) to update banners.
- **ADR‑4**: Abort stops new starts and suppresses UI mutations; in‑flight calls settle.
- **ADR‑5**: Optional telemetry for latency, errors, timeouts, wall time.
