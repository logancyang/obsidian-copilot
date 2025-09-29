# 7) Non‑Functional Requirements

- **NFR1**: Protocol stability — no change to `<use_tool>` or stream markers.
- **NFR2**: Determinism — final array order equals input order.
- **NFR3**: Performance — for 10 `webSearch` calls, median wall time improves by ≥40% vs sequential in synthetic test.
- **NFR4**: Compatibility — existing tests green; new tests added without removals.
- **NFR5**: Resilience — failures/timeouts do not block other calls; aggregate status per call.
- **NFR6**: Rate‑safety — cap and optional backoff for rate-limited tools.
- **NFR7**: Observability — metrics sufficient to compare sequential vs parallel behavior.
