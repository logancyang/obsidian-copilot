# 5) Coordinator Design

## 5.1 Scheduling

- Concurrency‑limited queue (cap default **4**, clamp 1..10).
- Round‑robin fairness: start in index order; refill as each settles.
- Stable ordering: results stored at `results[call.index]`.

## 5.2 Pseudocode

```ts
async function executeToolCallsInParallel(calls: ToolCall[], opts: ExecOptions = {}) {
  const { concurrency = 4, signal, hooks } = opts;
  const results: ToolResult[] = new Array(calls.length);
  let inFlight = 0;
  let next = 0;

  return await new Promise<ToolResult[]>((resolve) => {
    const startOne = () => {
      if (signal?.aborted || next >= calls.length) return;
      const i = next++;
      const c = calls[i];
      hooks?.onStart?.(i, { name: c.name, background: c.background });
      inFlight++;
      executeToolCall(c, { signal })
        .then((r) => r)
        .catch((e) => ({ index: i, name: c.name, status: "error", error: String(e) }))
        .then((r) => {
          results[i] = r;
          if (!signal?.aborted) hooks?.onSettle?.(i, r);
        })
        .finally(() => {
          inFlight--;
          pump();
        });
    };

    const pump = () => {
      if (signal?.aborted) {
        resolve(results);
        return;
      }

      while (inFlight < concurrency && next < calls.length) startOne();
      if (next >= calls.length && inFlight === 0) resolve(results);
    };

    pump();
  });
}
```

## 5.3 Error, Timeout, Cancel

- Use existing single‑call path for timeouts, gating, and normalization.
- Map failures to `{status:"error"| "timeout", error}`.
- On abort: do not start new calls; suppress UI updates after abort; still capture final results for logs.
