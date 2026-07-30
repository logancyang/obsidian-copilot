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

Install a current [Node.js](https://nodejs.org/) release, then run these commands separately in **PowerShell**:

```powershell
npm install -g @openai/codex
npm uninstall -g @zed-industries/codex-acp
npm install -g @agentclientprotocol/codex-acp
codex login
codex-acp --version
```

Finish the Codex login flow. The final command must report a version beginning with `@agentclientprotocol/codex-acp`.

In Obsidian: **Settings -> Copilot -> Agents -> Codex -> Configure -> Auto-detect**. The maintained npm package normally installs `codex-acp.cmd`; Copilot resolves that shim to its Node entry point before starting it.

Open a Copilot chat, switch to **Agent Mode**, pick **Codex**, and send a message.

> Select `codex-acp.cmd`, not the Codex CLI's `codex.exe` or `codex.cmd`.
