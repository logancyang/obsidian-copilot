# Windows Setup for Agent

Copilot Agent runs in the Obsidian desktop app. On Windows, start with **opencode** unless you already use Claude Code or Codex.

## 1. Install opencode with Copilot

1. Open **Settings → Copilot → Basic** and scroll to **Agents**.
2. Open the **opencode** tab.
3. Click **Download opencode**. Copilot downloads the correct Windows executable and keeps it outside your vault.
4. When the status shows **Ready**, choose a **Default model** and set **Default backend** to **opencode**.

No PowerShell command or PATH setup is needed for the managed installation.

Already have opencode? Click **I already have it**. Copilot checks common Windows install locations. If it cannot find your copy, click **Configure**, choose **My own binary**, then use **Auto-detect** or paste the absolute path to `opencode.exe` and click **Apply**. Custom installs must be opencode 1.16.0 or newer.

## 2. Use Claude Code instead

Claude uses the Claude Code installation and login already on your computer. Copilot requires Claude Code 2.1.206 or newer.

1. Open **Settings → Copilot → Basic → Agents → Claude** and click **Configure**.
2. If Claude Code is installed, click **Auto-detect** under **Claude Code binary**.
3. If it is not installed, run the **Install it** command shown in the dialog from PowerShell:

```powershell
irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex
```

4. Return to **Configure Claude** and click **Auto-detect**. If detection still fails, paste the absolute path to `claude.exe` and click **Apply**.
5. If the dialog shows **Sign in**, click it and complete the browser login. The equivalent PowerShell command is:

```powershell
claude auth login --claudeai
```

Copilot inherits Claude Code's credentials; there is no API key to paste into this dialog. If Copilot reports that the detected version is unsupported, rerun the installer to update Claude Code and detect it again.

## 3. Use Codex instead

Codex needs both the Codex CLI and the native `codex-acp.exe` adapter.

1. Open **Settings → Copilot → Basic → Agents → Codex** and click **Configure**.
2. Run the **Install it** command shown in **Configure Codex** from PowerShell:

```powershell
irm https://gist.githubusercontent.com/logancyang/380ef4dbf9f98900771da76eca3d21e6/raw/install-codex-agent-mode-windows.ps1 | iex
```

The script installs the Codex CLI, starts its login, downloads the matching Windows `codex-acp.exe`, and copies the adapter path to your clipboard.

3. Return to **Configure Codex** and click **Auto-detect** under **codex-acp binary**. If detection fails, paste the copied `codex-acp.exe` path and click **Apply**.
4. If sign-in did not finish, run:

```powershell
codex login
```

Configure the path to `codex-acp.exe`, not `codex.exe` or a `.cmd` launcher. Copilot inherits the Codex CLI login; leave **Environment variables** empty unless you intentionally need an override.

## Share skills across agents

Open **Settings → Copilot → Skills** and toggle the opencode, Claude, or Codex icons for each skill. Copilot keeps one shared copy and creates folder links into `.opencode/skills/`, `.claude/skills/`, and `.agents/skills/`.

If the Skills tab shows **Windows needs Developer Mode for multi-agent fanout**, enable **Windows Settings → Privacy & security → For developers → Developer Mode**. Administrator access is the other option. Then toggle the affected agent off and on to recreate its link.

If a sync service replaces a folder link and a skill disappears from an agent, toggle that agent off and on again in the **Skills** tab.

## Open Agent

Run **Open Copilot Agent Chat Window** from the command palette, or use the Agent ribbon icon. Choose an installed agent and click **Start chat**.

For models, permissions, projects, and multi-agent use, see [Agents in Copilot V4](agent-mode-and-tools.md).
