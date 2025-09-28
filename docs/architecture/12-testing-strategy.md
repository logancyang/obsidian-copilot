# 12) Testing Strategy

- **Unit (utils):** ordering with staggered latencies; timeout propagation; error mapping; abort behavior; cap boundaries.
- **Integration (runners):** 5–10 mixed tools; marker updates per settle; final string equality to sequential; `localSearch` parity.
- **Snapshot:** assembled prompt/context equality.
- **Chaos:** randomized failures/timeouts; verify partial success and non‑blocking behavior.
