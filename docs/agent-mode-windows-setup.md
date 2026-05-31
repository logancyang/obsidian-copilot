# Windows Setup for Claude Code Agent Mode

Run these in **PowerShell**, in order.

```powershell
# 1. Install Claude Code (standalone, no Node.js needed)
irm https://claude.ai/install.ps1 | iex

# 2. Add it to PATH for this session and sign in
$env:Path += ";$env:USERPROFILE\.local\bin"
claude
```

Finish signing in when `claude` opens, then close it.

```powershell
# 3. Print the exact binary path to paste into Copilot
(Resolve-Path "$env:USERPROFILE\.local\bin\claude.exe").Path
```

In Obsidian: **Settings → Copilot → Agent Mode → Claude → Configure → Auto-detect**. If it doesn't find Claude, paste the path from step 3 into the binary path field.

That's it. Open a Copilot chat, switch to **Agent Mode**, pick **Claude**, and send a message.

> A "not in your PATH" warning after step 1 is normal and does not matter — Copilot finds Claude by file path, not PATH.
