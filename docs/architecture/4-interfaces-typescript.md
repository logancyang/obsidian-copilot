# 4) Interfaces (TypeScript)

```ts
export interface ToolCall {
  index: number; // input position
  id?: string; // stable tool-call id (if available)
  name: string;
  args: unknown;
  background?: boolean;
  timeoutMs?: number;
}

export type ToolStatus = "ok" | "error" | "timeout" | "cancelled";

export interface ToolResult {
  index: number;
  name: string;
  status: ToolStatus;
  payload?: unknown;
  error?: string;
}

export interface ExecHooks {
  onStart?: (index: number, meta: { name: string; background?: boolean }) => void;
  onSettle?: (index: number, result: ToolResult) => void;
}

export interface ExecOptions {
  concurrency?: number; // default 4
  signal?: AbortSignal;
  hooks?: ExecHooks;
}
```
