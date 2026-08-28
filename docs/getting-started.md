# Getting Started with Copilot V4

Copilot V4 is built around **Agent Chat**, a desktop workspace where opencode, Claude Code, Codex, or Antigravity can read your vault, use tools, and complete multi-step work with the permissions you choose.

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

### Alternative: Link Antigravity

Antigravity 2.x can be linked through its official `agy` CLI:

1. Install Antigravity and sign in through the [official Antigravity website](https://antigravity.google/).
2. Open **Basic → Agents → Antigravity → Configure**.
3. Click **Auto-detect**, or enter the absolute path to `agy` (`agy.exe` on Windows).

Copilot runs the bound `agy` CLI and reuses its account credentials. It does not
ask for an Antigravity API key. The models returned by `agy models` become
available under **Basic → Agents → Antigravity** and can also be enabled for
**Quick Chat**.

### Alternative: Link Codex

Copilot connects to Codex through the `codex-acp` adapter. If you already use Codex:

1. Install the adapter for your platform:
   - **Windows:** follow [Windows setup for Agent Chat](agent-mode-windows-setup.md#3-connect-codex). Its PowerShell installer downloads the native `codex-acp.exe` that Copilot requires.
   - **macOS or Linux:** run:

     ```bash
     npm install -g @agentclientprotocol/codex-acp
     ```

2. Run `codex login` if the Codex CLI is not already signed in.
3. Open **Basic → Agents → Codex → Configure**, then use **Auto-detect** or enter the path to `codex-acp.exe` on Windows or `codex-acp` on macOS and Linux.

Codex inherits the Codex CLI's credentials; there is no Codex key to paste into Copilot.

## Start Your First Agent Chat

1. Click the **Agent Chat** ribbon icon, or run **Open Copilot Agent Chat Window** from the command palette.
2. If **Select your agent** appears, choose an **Installed** agent and select **Start chat**. When the default backend is already ready, Copilot opens its chat automatically.
3. Pick a model and permission setting beside the message box, then describe the outcome you want.

Try a concrete first request such as: “Review the unfinished tasks in this vault and make a short plan.” With **Default** selected, Agent Chat shows its work and asks before actions that need your approval.

## Projects, Skills, and Commands

### Keep Work Focused with Projects

From Agent Chat Home, open **Projects** and select **New project**. A project keeps its own instructions, reusable context, and chat history, so work for one client or topic stays together. See [Projects](projects.md) for supported context sources and setup.

### Share Skills Across Agents

Skills are reusable instruction packets for jobs such as reviewing a change or drafting a release note. Open **Settings → Copilot → Skills** to see skills from Copilot's shared skills folder and the native opencode, Claude, Codex, and Antigravity skill folders. Enable each skill for the agents that should use it; Copilot links shared skills into the right agent folders for you.

Type `/` in Agent Chat to choose an available skill. Copilot also includes skills for Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. Learn more in [Skills across agents](agent-mode-and-tools.md#skills-across-agents).

### Reuse Copilot Commands

Create preset prompts under **Settings → Copilot → Command**. Run them from the command palette, the editor's **Copilot** menu, or by typing `/` in Agent Chat. See [Copilot Commands and Quick Ask](custom-commands.md).

### Ask Without Leaving the Editor

Run **Quick Ask** from the command palette, or assign it a hotkey under **Obsidian Settings → Hotkeys**. It opens a small prompt beside your cursor or selection for quick rewrites, explanations, and follow-up questions. Quick Ask uses your Quick Chat model. Quick Chat can use Copilot-hosted/BYOK models, or any enabled model from a bound opencode, Claude, Codex, or Antigravity account.

## Next Steps

- [Agent Chat](agent-mode-and-tools.md): agents, permissions, context, models, and skills
- [Projects](projects.md): focused agent workspaces
- [Copilot Commands and Quick Ask](custom-commands.md): reusable prompts and in-editor help
- [Model Sources and BYOK](llm-providers.md): BYOK and bound Agent accounts for Quick Chat
- [Copilot Settings](settings.md): every settings tab explained
