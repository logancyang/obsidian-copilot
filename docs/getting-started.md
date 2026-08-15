# Getting Started with Copilot V4

Copilot V4 is built around **Agent**, a desktop workspace where opencode, Claude Code, or Codex can read your vault, use tools, and complete multi-step work with the permissions you choose.

Agent is available in Obsidian on desktop. Quick Chat, custom commands, and Quick Ask are also available for shorter tasks.

## Install Copilot

1. Open **Obsidian Settings → Community plugins**.
2. Select **Browse**, search for **Copilot**, and install it.
3. Enable Copilot. The Agent icon appears in the left ribbon on desktop.

## Set Up Your First Agent

Open **Settings → Copilot → Basic** and find **Agents**. For most people, the quickest path is the managed opencode setup.

### Recommended: Download opencode

1. Select the **opencode** tab under **Agents**.
2. Click **Download opencode**. Copilot downloads the binary and manages it for you.
3. Choose how opencode gets models:
   - **Copilot-hosted models:** enter an eligible license under **Copilot License** on the Basic tab. Eligible hosted models then appear in opencode and Quick Chat.
   - **Bring your own key:** open the **BYOK** tab, select **Add a provider**, enter your provider details, and choose models. Copilot stores the key in this device's Obsidian Keychain and enables the selected models for opencode and Quick Chat.
4. Return to **Basic → Agents → opencode** and choose the default model for new chats.

Already have opencode? Click **I already have it**. If detection fails, click **Configure**, choose **My own binary**, and enter its absolute path.

### Alternative: Link Claude Code

If Claude Code is already installed, Copilot checks its common install locations automatically and marks **Claude** as installed. If it is not found:

1. Open **Basic → Agents → Claude → Configure**.
2. Select **Auto-detect**, or enter the path to the `claude` binary.
3. Sign in when prompted.

Claude uses the account held by the Claude Code CLI. You do not paste that account's key into Copilot.

### Alternative: Link Codex

Copilot connects to Codex through the `codex-acp` adapter. If you already use Codex:

1. Install the adapter for your platform:
   - **Windows:** follow [Windows Setup for Agent](agent-mode-windows-setup.md#3-use-codex-instead). Its PowerShell installer downloads the native `codex-acp.exe` that Copilot requires.
   - **macOS or Linux:** run:

     ```bash
     npm install -g @agentclientprotocol/codex-acp
     ```

2. Run `codex login` if the Codex CLI is not already signed in.
3. Open **Basic → Agents → Codex → Configure**, then use **Auto-detect** or enter the path to `codex-acp.exe` on Windows or `codex-acp` on macOS and Linux.

Codex inherits the Codex CLI's credentials; there is no Codex key to paste into Copilot.

## Start Your First Agent Chat

1. Click the **Agent** ribbon icon, or run **Open Copilot Agent Chat Window** from the command palette.
2. If **Select your agent** appears, choose an **Installed** agent and select **Start chat**. When the default backend is already ready, Copilot opens its chat automatically.
3. Pick a model and operating mode beside the message box, then describe the outcome you want.

Try a concrete first request such as: “Review the unfinished tasks in this vault and make a short plan.” In **Default** mode, Agent shows its work and asks before actions that need your approval.

## Projects, Skills, and Commands

### Keep Work Focused with Projects

From Agent Home, open **Projects** and select **New project**. A project keeps its own instructions, reusable context, and chat history, so work for one client or topic stays together. See [Projects](projects.md) for supported context sources and setup.

### Share Skills Across Agents

Skills are reusable instruction packets for jobs such as reviewing a change or drafting a release note. Open **Settings → Copilot → Skills** to see skills from Copilot's shared skills folder and the native opencode, Claude, and Codex skill folders. Enable each skill for the agents that should use it; Copilot links shared skills into the right agent folders for you.

Type `/` in Agent to choose an available skill. Copilot also includes skills for Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. Learn more in [Agents in Copilot V4](agent-mode-and-tools.md#skills-shared-across-agents).

### Reuse Copilot Commands

Create preset prompts under **Settings → Copilot → Command**. Run them from the command palette, the editor's **Copilot** menu, or by typing `/` in Agent. See [Custom Commands](custom-commands.md).

### Ask Without Leaving the Editor

Run **Quick Ask** from the command palette, or assign it a hotkey under **Obsidian Settings → Hotkeys**. It opens a small prompt beside your cursor or selection for quick rewrites, explanations, and follow-up questions. Quick Ask uses your Quick Chat model, so set up a Copilot-hosted or BYOK model first.

## Next Steps

- [Agents in Copilot V4](agent-mode-and-tools.md) — permissions, context, models, and skills
- [Projects](projects.md) — focused Agent workspaces
- [Custom Commands](custom-commands.md) — reusable prompts and Quick Ask
- [LLM Providers](llm-providers.md) — provider-specific BYOK setup
