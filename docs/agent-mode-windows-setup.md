# Windows Setup for Agent Mode

Use this guide to connect Claude Code or Codex to Copilot Agent Mode on Windows.

## Claude Code

Run this in **PowerShell**:

```powershell
irm https://raw.githubusercontent.com/logancyang/obsidian-copilot/v4-preview/docs/install-claude-agent-mode-windows.ps1 | iex
```

When Claude asks you to sign in, finish the login, then close Claude. The installer copies the `claude.exe` path to your clipboard.

In Obsidian: **Settings -> Copilot -> Agent Mode -> Claude -> Configure -> Auto-detect**. If it doesn't find Claude, paste the copied path into the binary path field, then save.

Open a Copilot chat, switch to **Agent Mode**, pick **Claude**, and send a message.

> A "not in your PATH" warning is normal and does not matter: Copilot finds Claude by file path, not PATH.

## Codex

Run this in **PowerShell**:

```powershell
irm https://raw.githubusercontent.com/logancyang/obsidian-copilot/v4-preview/docs/install-codex-agent-mode-windows.ps1 | iex
```

When Codex asks you to sign in, finish the login. The installer copies the `codex-acp.exe` path to your clipboard.

In Obsidian: **Settings -> Copilot -> Agent Mode -> Codex -> Configure**. Paste the copied path into the binary path field, leave **Environment variables** empty, then save.

Open a Copilot chat, switch to **Agent Mode**, pick **Codex**, and send a message.

> Use the copied `codex-acp.exe` path only. Do not use `codex.exe`, `codex.cmd`, or `codex-acp.cmd`.
