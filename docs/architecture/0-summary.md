# 0) Summary

Introduce a concurrency coordinator in `toolExecution.ts` and switch both runners to use it. Keep XML `<use_tool>` protocol, deterministic ordered aggregation, and existing marker semantics. Add a feature flag and a concurrency cap. Primary benefit: parallel web searches and other I/O tools with no downstream contract drift.
