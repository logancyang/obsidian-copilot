# Windows Setup for Agent Mode

Use this guide to connect Claude Code or Codex to Copilot Agent Mode on Windows.

## Claude Code

Run this in **PowerShell**:

```powershell
irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex
```

When Claude asks you to sign in, finish the browser login. The installer copies the `claude.exe` path to your clipboard.

In Obsidian: **Settings -> Copilot -> Agents -> Claude -> Configure -> Auto-detect**. If it doesn't find Claude, paste the copied path into the binary path field, then save.

Open a Copilot chat, switch to **Agent Mode**, pick **Claude**, and send a message.

> A "not in your PATH" warning is normal and does not matter: Copilot finds Claude by file path, not PATH.

## Codex

Install a current [Node.js](https://nodejs.org/) release for Windows, then run this command in
native **Windows PowerShell**:

```powershell
irm https://gist.githubusercontent.com/zeroliu/8914d6b923724cfa7a6169ebdc7a0bc0/raw/install-codex-agent-mode-windows.ps1 | iex
```

Do not run the installer inside WSL. Obsidian runs on Windows, so it needs the adapter installed by
Windows `node.exe` and `npm.cmd`. The installer removes the superseded adapter, installs the
maintained adapter with its compatible Codex dependency, verifies its package identity, and copies
the `codex-acp.cmd` path to your clipboard. If no Codex API key is available, it also opens the
bundled Codex CLI's ChatGPT sign-in flow.

In Obsidian: **Settings -> Copilot -> Agents -> Codex -> Configure -> Auto-detect**. If it doesn't
find Codex, paste the copied path into the binary path field, then save. Copilot resolves the npm
command shim to its Node entry point before starting it.

Open a Copilot chat, switch to **Agent Mode**, pick **Codex**, and send a message.

> Select `codex-acp.cmd`, not the Codex CLI's `codex.exe` or `codex.cmd`.
