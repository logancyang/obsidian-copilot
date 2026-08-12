# Windows Setup for Agent Mode

Use this guide to connect OpenCode, Claude Code, or Codex to Copilot Agent Mode on Windows.

## OpenCode (Recommended)

Open Agent Mode from the left ribbon or run **Open Copilot Agent Chat Window**. Choose **OpenCode**, then select **Download OpenCode** to let Copilot install and manage it for you.

If you already installed OpenCode, choose **I already have it** and let Copilot find the binary or enter its path. You can change the source later under **Settings → Copilot → Basic → Agents → OpenCode → Configure**.

## Claude Code

Run this in **PowerShell**:

```powershell
irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex
```

When Claude asks you to sign in, finish the browser login. The installer copies the `claude.exe` path to your clipboard.

In Obsidian: **Settings -> Copilot -> Basic -> Agents -> Claude -> Configure -> Auto-detect**. If it doesn't find Claude, paste the copied path into the binary path field, then save.

Run **Open Copilot Agent Chat Window**, pick **Claude**, and send a message.

> A "not in your PATH" warning is normal and does not matter: Copilot finds Claude by file path, not PATH.

## Codex

Run this in **PowerShell**:

```powershell
irm https://gist.githubusercontent.com/logancyang/380ef4dbf9f98900771da76eca3d21e6/raw/install-codex-agent-mode-windows.ps1 | iex
```

When Codex asks you to sign in, finish the login. The installer copies the `codex-acp.exe` path to your clipboard.

In Obsidian: **Settings -> Copilot -> Basic -> Agents -> Codex -> Configure**. Paste the copied path into the binary path field, leave **Environment variables** empty, then save.

Run **Open Copilot Agent Chat Window**, pick **Codex**, and send a message.

> Use the copied `codex-acp.exe` path only. Do not use `codex.exe`, `codex.cmd`, or `codex-acp.cmd`.
