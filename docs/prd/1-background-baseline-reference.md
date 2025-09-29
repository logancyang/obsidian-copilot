# 1) Background (Baseline Reference)

This PRD supersedes v0.1 using findings from `document-project.md` (baseline). Baseline confirms:

- Sequential tool execution per turn.
- Downstream assumes ordered results aligned to input indices.
- XML `<use_tool>` protocol and streaming delimiters (`</use_tool>`) are stable contracts.
- Background tools emit no UI markers.
- Timeouts and Plus gating live in the execution utility.

## System Overview (from baseline)

- **Domain:** Obsidian Copilot agentic runtime with tool calls emitted via textual XML blocks `<use_tool>…</use_tool>` embedded in assistant output.
- **Runners:**
  - `AutonomousAgentChainRunner` — drives autonomous tool-using loops.
  - `CopilotPlusChainRunner` — prepares pre‑chat context and orchestrates Copilot Plus tools.
- **Tool Execution Utility:** `toolExecution.ts` centralizes validation, Plus gating, and timeout control.
- **Streaming & Truncation:** `ThinkBlockStreamer` scans for closing `</use_tool>` tags to delineate tool blocks for UI streaming.
- **Post‑processing:** `processToolResults` in `toolResultUtils.ts` merges ordered tool outputs into the assistant’s next message, memory, and user‑facing tool‑result payloads.

> Baseline behavior: **sequential execution** of tool calls per turn. Results are consumed in **input order**. Banners/markers reflect start → complete per tool.
