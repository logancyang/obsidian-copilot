# Parallel Tool Execution - Brownfield Enhancement

## Epic Goal

Deliver a concurrency-aware tool execution flow that lowers turn wall time while preserving ordered results, existing UI markers, and gating behavior.

## Epic Description

### Existing System Context

- Current relevant functionality: Runners execute tool calls sequentially via `executeSequentialToolCall`, streaming `<use_tool>` markers in order.
- Technology stack: TypeScript codebase targeting Obsidian plugin runtime with LLM provider abstraction.
- Integration points: `toolExecution.ts`, `AutonomousAgentChainRunner`, `CopilotPlusChainRunner`, `toolResultUtils.ts`, configuration service.

### Enhancement Details

- What's being added/changed: Introduce a concurrency coordinator with capped parallelism and shared hooks, updating both runners to consume it.
- How it integrates: Replace sequential helper usage with `executeToolCall` + `executeToolCallsInParallel`, wiring hooks into existing banner pipeline and preserving downstream aggregation.
- Success criteria: Measurable ≥40% median wall-time improvement for multi-tool turns, deterministic ordered outputs, no regressions in gating or abort flows.

## Stories

1. **Coordinator Utilities** — Implement `executeToolCall` core and `executeToolCallsInParallel` scheduler with concurrency cap, hooks, and abort handling.
2. **Autonomous Runner Integration** — Adopt coordinator in `AutonomousAgentChainRunner`, wiring markers via hooks and verifying ordered aggregation.
3. **Copilot+ Integration & Telemetry** — Integrate coordinator in `CopilotPlusChainRunner`, preserve `localSearch` post-processing, and emit optional latency telemetry.

## Compatibility Requirements

- [ ] Maintain XML `<use_tool>` protocol and ordered results consumed by downstream formatters.
- [ ] Keep Plus gating, timeouts, and normalization identical to sequential path.
- [ ] UI marker semantics unchanged for visible vs background tools.
- [ ] Default concurrency cap and feature flag configurable via existing settings.

## Risk Mitigation

- **Primary Risk:** UI race conditions or reordered outputs causing user-visible inconsistencies.
- **Mitigation:** Preserve index-addressed result storage, serialize marker updates through hooks, add snapshot tests for prompt/context parity.
- **Rollback Plan:** Toggle `parallelToolCalls.enabled` off to revert to sequential execution while retaining coordinator code for future adjustments.

## Definition of Done

- [ ] All three stories implemented with green unit, integration, snapshot, and chaos tests described in PRD.
- [ ] Final prompt/context outputs match sequential behavior byte-for-byte under deterministic inputs.
- [ ] Telemetry captures per-tool latency, wall time, and error status when feature flag is enabled.
- [ ] Documentation updated (PRD/Architecture references, config entries) and configuration defaults validated.
- [ ] No regressions observed in sequential fallback or Plus-gated tool execution.
