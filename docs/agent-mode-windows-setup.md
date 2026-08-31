# Windows setup for Agent Chat

Agent Chat runs in the Obsidian desktop app. On Windows, start with **opencode** unless you already use Claude Code or Codex.

## 1. Install opencode with Copilot

1. Open [**Settings → Copilot → Basic → Agents**](settings.md#basic).
2. Open the **opencode** tab.
3. Select **Download opencode**. Copilot downloads and manages the Windows executable outside your vault.
4. When the status shows **Ready**, choose a **Default model** and set **Default backend** to **opencode**.

The managed installation does not require a PowerShell command or PATH changes.

If opencode is already installed, select **I already have it**. Copilot checks common Windows locations. If it cannot find your copy, open **Configure**, choose **My own binary**, then select **Auto-detect** or enter the absolute path to `opencode.exe` and select **Apply**.

If Copilot reports that your opencode version is unsupported, update opencode and run detection again.

## 2. Connect Claude Code

The Claude backend uses the Claude Code installation and account already on your computer.

1. Open **Settings → Copilot → Basic → Agents → Claude** and select **Configure**.
2. If Claude Code is installed, select **Auto-detect** under **Claude Code binary**.
3. If it is not installed, copy the current **Install it** command from the dialog and run it in PowerShell.
4. Return to **Configure Claude** and select **Auto-detect** again. If detection still fails, enter the absolute path to `claude.exe` and select **Apply**.
5. If the dialog shows **Sign in**, select it and complete the browser login.

You can also start the Claude Code login from PowerShell:

```powershell
claude auth login --claudeai
```

Copilot uses Claude Code's credentials. Do not add an Anthropic API key to this dialog. If Copilot reports that the installed version is unsupported, update Claude Code and detect it again.

## 3. Connect Codex

The Codex backend needs `@agentclientprotocol/codex-acp` 0.0.38 or newer. The package includes a compatible Codex CLI; the older `@zed-industries/codex-acp` adapter is not supported.

1. Open **Settings → Copilot → Basic → Agents → Codex** and select **Configure**.
2. Copy the **Install it** command from the dialog and run it in PowerShell. The first command removes the unsupported Zed npm package because both packages create the same global `codex-acp` command; the second installs the supported adapter.

```powershell
npm uninstall -g @zed-industries/codex-acp; npm install -g @agentclientprotocol/codex-acp
```

3. Return to **Configure Codex** and select **Auto-detect** under **codex-acp adapter**.
4. If detection fails, enter the expanded absolute path to the package entry, such as `C:\Users\<your-user-name>\AppData\Roaming\npm\node_modules\@agentclientprotocol\codex-acp\dist\index.js`, and select **Apply**. Replace `<your-user-name>` with your Windows user folder; the path field does not expand `%APPDATA%`.
5. Sign in through the installed adapter:

```powershell
codex-acp login
```

Configure the package's `dist\index.js`, not `codex.exe`, `codex-acp.cmd`, or a legacy `codex-acp.exe`. Copilot launches the JavaScript entry point with the Node.js installation that provided npm and uses the bundled Codex CLI's login. If Node was installed while Obsidian was open, restart Obsidian before Auto-detect. Leave **Environment variables** empty unless you intentionally need an override.

## Share Skills across agents

Open [**Settings → Copilot → Skills**](settings.md#skills) and toggle the opencode, Claude, or Codex icons for each Skill. Copilot keeps one shared copy and creates folder links into `.opencode/skills/`, `.claude/skills/`, and `.agents/skills/`.

Windows may block creation of these links. Enable **Windows Settings → Privacy & security → For developers → Developer Mode**, or run Obsidian with administrator access, then toggle the affected agent off and on in the **Skills** tab.

If a sync service replaces a folder link and a Skill disappears from an agent, toggle that agent off and on again to recreate the link.

## Open Agent Chat

Select the **Agent Chat** ribbon icon or run **Open Copilot Agent Chat Window** from the command palette. Choose an installed agent and select **Start chat**.

For models, effort, permissions, Projects, and multi-agent answers, see [Agent Chat](agent-mode-and-tools.md).
