# 6) Runner Integration

## 6.1 Autonomous

- Parse `<use_tool>` as today.
- Pre‑register markers for non‑background tools.
- Call coordinator with hooks:
  - `onStart` → mark “starting …”
  - `onSettle` → success/timeout/error update
- Pass ordered results to `processToolResults` (no formatting change).

## 6.2 Copilot+

- Replace sequential loop with coordinator.
- Keep `localSearch` post‑processing and exact prompt/context assembly.
