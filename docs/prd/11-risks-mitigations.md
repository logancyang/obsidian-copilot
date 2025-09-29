# 11) Risks & Mitigations

- UI race conditions → gate updates on `signal.aborted`; per-index serialized updates.
- Hidden order coupling → snapshot tests of assembled strings; strict index ordering.
- Rate limits → default cap=4; optional exponential backoff for marked tools.
- Tool starvation → fair queue in scheduler.
