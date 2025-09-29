# 3) Logical Architecture

```
[Autonomous Runner] ─┐
[Copilot+ Runner] ───┼──▶ [Coordinator (parallel; capped)] ─▶ [Ordered Results]
                     │
                     └──▶ hooks: onStart / onSettle / signal
Ordered Results ─▶ processToolResults ─▶ memory/user messages (unchanged)
ToolManager.callTool + timeouts/gating (unchanged)
```

Mermaid sequence:

```mermaid
sequenceDiagram
  participant User
  participant Runner
  participant Coord as Coordinator
  participant TM as ToolManager
  participant Tool as Tool(N)

  User->>Runner: message with <use_tool> blocks
  Runner->>Coord: executeToolCallsInParallel(calls,{hooks,signal,cap})
  loop up to concurrency cap
    Coord->>Runner: onStart(i, meta)
    Coord->>TM: callTool(call_i)
    TM->>Tool: run(args, timeout, gating)
    Tool-->>TM: result / error / timeout
    TM-->>Coord: ToolResult(i,status,payload)
    Coord->>Runner: onSettle(i, ToolResult)
  end
  Coord->>Runner: array ordered by input index
  Runner->>Runner: processToolResults(ordered)
  Runner-->>User: same banners and aggregated outputs
```
