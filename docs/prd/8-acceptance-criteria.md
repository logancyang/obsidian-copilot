# 8) Acceptance Criteria

- **AC1**: With flag ON, `concurrency=4`, synthetic suite of 10 webSearch calls reduces median wall time by ≥40% vs sequential; p95 improves materially.
- **AC2**: Final prompt/context strings for both runners are byte-identical to sequential given identical inputs and results.
- **AC3**: Background tools produce no markers; visible tools show start/settle updates.
- **AC4**: Timeouts and Plus gating behavior match sequential path.
- **AC5**: Aborting a turn halts further marker updates without corrupting aggregation.
