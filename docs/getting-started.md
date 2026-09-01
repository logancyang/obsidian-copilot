# Getting Started with Copilot V4

Copilot V4 is built around **Agent Chat**, a desktop workspace where opencode, Claude Code, or Codex can read your vault, use tools, and complete multi-step work with the permissions you choose.

Agent Chat is available in Obsidian on desktop. Quick Chat, Copilot Commands, and Quick Ask remain available for shorter tasks and on mobile.

## Install Copilot

1. Open **Obsidian Settings → Community plugins**.
2. Select **Browse**, search for **Copilot**, and install it.
3. Enable Copilot. The Agent Chat icon appears in the left ribbon on desktop.

## Set Up Your First Agent Chat

Open **Settings → Copilot → Basic** and find **Agents**. For most people, the quickest path is the managed opencode setup.

### Recommended: Download opencode

1. Select the **opencode** tab under **Agents**.
2. Click **Download opencode**. Copilot downloads the `opencode` binary and manages it for you.
3. Choose how opencode gets models:
   - **Copilot-hosted models:** enter an eligible license under **Copilot License** on the Basic tab. Eligible hosted models then appear in opencode and Quick Chat.
   - **Bring your own key:** open the **BYOK** tab, select **Add a provider**, enter your provider details, and choose models. Copilot stores the key in this device's Obsidian Keychain and enables the selected models for opencode and Quick Chat.
4. Return to **Basic → Agents → opencode** and choose the default model for new chats.

Already have the `opencode` binary? Click **I already have it**. If detection fails, click **Configure**, choose **My own binary**, and enter its absolute path.

### Alternative: Link Claude Code

If Claude Code is already installed, Copilot checks its common install locations automatically and marks **Claude** as installed. If it is not found:

1. Open **Basic → Agents → Claude → Configure**.
2. Select **Auto-detect**, or enter the path to the `claude` binary.
3. Sign in when prompted.

Claude uses the account held by the Claude Code CLI. You do not paste that account's key into Copilot.

### Alternative: Link Codex

Copilot connects to Codex through the `codex-acp` adapter, which includes a compatible Codex CLI:

1. Open **Basic → Agents → Codex → Configure** and run the displayed install command:

   ```text
   npm uninstall -g @zed-industries/codex-acp; npm install -g @agentclientprotocol/codex-acp
   ```

   Removing the unsupported Zed package first prevents its global `codex-acp` command from blocking installation.

2. Run `codex-acp login` if Codex is not already signed in.
3. Use **Auto-detect**. On Windows, manual setup points to the installed package's `dist\index.js`; on macOS and Linux, it points to the `codex-acp` launcher.

Copilot requires `@agentclientprotocol/codex-acp` 0.0.38 or newer. The older `@zed-industries/codex-acp` package is not supported. Codex uses the login stored by the bundled Codex CLI; there is no Codex key to paste into Copilot.

## Start Your First Agent Chat

1. Click the **Agent Chat** ribbon icon, or run **Open Copilot Agent Chat Window** from the command palette.
2. If **Select your agent** appears, choose an **Installed** agent and select **Start chat**. When the default backend is already ready, Copilot opens its chat automatically.
3. Pick a model and permission setting beside the message box, then describe the outcome you want.

Try a concrete first request such as: “Review the unfinished tasks in this vault and make a short plan.” With **Default** selected, Agent Chat shows its work and asks before actions that need your approval.

## Projects, Skills, and Commands

### Keep Work Focused with Projects

From Agent Chat Home, open **Projects** and select **New project**. A project keeps its own instructions, reusable context, and chat history, so work for one client or topic stays together. See [Projects](projects.md) for supported context sources and setup.

### Share Skills Across Agents

Skills are reusable instruction packets for jobs such as reviewing a change or drafting a release note. Open **Settings → Copilot → Skills** to see skills from Copilot's shared skills folder and the native opencode, Claude, and Codex skill folders. Enable each skill for the agents that should use it; Copilot links shared skills into the right agent folders for you.

Type `/` in Agent Chat to choose an available skill. Copilot also includes skills for Obsidian Markdown, Bases, Canvas, and the Obsidian CLI, plus an optional screenpipe activity-history workflow. Learn more in [Skills across agents](agent-mode-and-tools.md#skills-across-agents).

### Reuse Copilot Commands

Create preset prompts under **Settings → Copilot → Command**. Run them from the command palette, the editor's **Copilot** menu, or by typing `/` in Agent Chat. See [Copilot Commands and Quick Ask](custom-commands.md).

### Ask Without Leaving the Editor

Run **Quick Ask** from the command palette, or assign it a hotkey under **Obsidian Settings → Hotkeys**. It opens a small prompt beside your cursor or selection for quick rewrites, explanations, and follow-up questions. Quick Ask uses your Quick Chat model, so set up a Copilot-hosted or BYOK model first.

## Next Steps

- [Agent Chat](agent-mode-and-tools.md): agents, permissions, context, models, and skills
- [Projects](projects.md): focused agent workspaces
- [Copilot Commands and Quick Ask](custom-commands.md): reusable prompts and in-editor help
- [Model Sources and BYOK](llm-providers.md): BYOK setup for opencode and Quick Chat
- [Copilot Settings](settings.md): every settings tab explained
