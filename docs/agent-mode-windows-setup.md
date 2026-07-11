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

Codex requires the current [Node.js LTS release](https://nodejs.org/), which includes npm. Install Node.js first, then reopen PowerShell.

Run this in **PowerShell**:

```powershell
irm https://raw.githubusercontent.com/logancyang/obsidian-copilot/v4-preview/docs/install-codex-agent-mode-windows.ps1 | iex
```

The installer removes the superseded adapter if it is present, installs `@agentclientprotocol/codex-acp`, checks its bundled Codex CLI, and copies the adapter's `dist\index.js` path to your clipboard.

You can rerun the installer to update or repair the adapter; it resolves and copies the active global npm package path each time.

In Obsidian: **Settings -> Copilot -> Agents -> Codex -> Configure -> Auto-detect**. If auto-detect does not find it, paste the copied `dist\index.js` path into the binary path field. Leave **Environment variables** empty, then save.

Open a Copilot chat, switch to **Agent Mode**, pick **Codex**, and send a message. Copilot will offer Codex sign-in when authentication is needed.

> The adapter includes a compatible Codex CLI. You do not need to install `@openai/codex` globally, and a separate `codex` command on PATH is not used. On Windows, configure the copied `dist\index.js` file—not `codex.exe`, `codex.cmd`, or `codex-acp.cmd`.

### Updating or replacing an older Codex adapter

The install command shown by Copilot is:

```powershell
npm install -g @agentclientprotocol/codex-acp
```

If Copilot says the installed adapter is unsupported, it shows this exact replacement command (supported by PowerShell 7):

```text
npm uninstall -g @zed-industries/codex-acp && npm install -g @agentclientprotocol/codex-acp
```

In Windows PowerShell 5, run the equivalent commands on separate lines:

```powershell
npm uninstall -g @zed-industries/codex-acp
npm install -g @agentclientprotocol/codex-acp
```

Then return to **Configure**, clear an old saved path if necessary, and click **Auto-detect** again.
