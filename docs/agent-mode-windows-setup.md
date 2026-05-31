# Windows Setup for Claude Code Agent Mode

This guide helps Windows users install Claude Code and connect it to Copilot's Agent Mode. You don't need any developer tools or experience.

> **Read this first.** The installer does **not** add Claude to your system PATH. This means typing `claude` in a terminal will say "not found" even when the install worked perfectly. **That's expected and it does not matter** — Copilot finds Claude by its file location, not your PATH. A failed `claude` command in the terminal does **not** mean something is broken.

## What you need

- Windows 10 or 11
- Obsidian with the Copilot plugin installed
- A Claude (Anthropic) account, with [Copilot Plus](copilot-plus-and-self-host.md) for Agent Mode

## Step 1: Install Claude Code

1. Open **PowerShell**: press the `Windows` key, type `PowerShell`, and press `Enter`.
2. Paste this command and press `Enter`:

   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

3. Wait until you see **`Installation complete!`**.

In the output, look for the **Location** line and note the path. It is almost always:

```
C:\Users\<your-username>\.local\bin\claude.exe
```

You may also see a warning that this folder is "not in your PATH." **Ignore it** — Copilot does not use your PATH. This installer does not require Node.js.

> **Already have Node.js?** You can instead run `npm install -g @anthropic-ai/claude-code`. The native installer above is recommended because it needs nothing else.

## Step 2: Sign in to Claude

Sign in to the **Claude desktop app**, or run `claude` once in a terminal if it happens to work on your machine. Copilot reuses this sign-in automatically. Without signing in, Agent Mode will start but every request will fail with an authentication error.

## Step 3: Connect Copilot to Claude

1. Open **Settings → Copilot → Agent Mode**.
2. Under the **Claude** backend, click **Configure**.
3. Click **Auto-detect**.

Auto-detect checks the standard install location, so it should find Claude right away — even though the `claude` command doesn't work in your terminal.

**If Auto-detect doesn't find it**, paste the path manually into the binary path field. To get the exact path, run this in PowerShell and copy the line it prints:

```powershell
(Resolve-Path "$env:USERPROFILE\.local\bin\claude.exe").Path
```

> Use a file ending in `.exe` (or `cli.js` for npm installs). Do **not** use a file ending in `.cmd` — Copilot cannot run those.

## Step 4: Start using Agent Mode

Open a Copilot chat, switch to **Agent Mode**, choose the **Claude** backend, and send a message. You're all set.

## Troubleshooting

**`claude` is "not found" in the terminal.**
Expected — the installer skips your PATH. This does not affect Copilot. Use Auto-detect (Step 3) or paste the path manually.

**Auto-detect can't find Claude.**
Paste the path manually using the `Resolve-Path` command in Step 3. If that command shows an error instead of a path, the install didn't complete — run Step 1 again.

**You see an error mentioning `node` (npm installs only).**
The npm version of Claude needs Node.js available. Either switch to the native installer in Step 1 (recommended), or add your Node.js folder to the **Environment variables** field in Configure Claude (for example, `PATH=C:\path\to\node`).

**`irm ... | iex` is blocked.**
Your security settings may block the install command. In PowerShell, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, then try Step 1 again.

## Optional: make `claude` work in the terminal too

This is **not needed for Copilot**. Only do this if you want to run `claude` directly in a terminal.

1. Press the `Windows` key, type **Environment Variables**, and open **Edit the system environment variables → Environment Variables…**.
2. Under **User variables**, select **Path → Edit → New**.
3. Add: `%USERPROFILE%\.local\bin`
4. Click **OK** on all dialogs, then close and reopen PowerShell.
5. Verify with `claude --help`.
