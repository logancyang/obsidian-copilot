# Agents in Copilot V4

Copilot V4 puts an AI agent inside Obsidian. It can read and search your notes, run tools, and edit files while you follow its work in chat.

Choose the agent that matches the access you already have:

- **opencode** — recommended. Use Copilot-hosted, BYOK, or local models. Copilot can install opencode for you.
- **Claude** — link an existing Claude Code installation and Anthropic account.
- **Codex** — link Codex through its `codex-acp` adapter and use the Codex CLI's existing login.

One-agent chat works without a Copilot license when you bring your own model access. Paid access can include Copilot-hosted models and cloud-backed tools. Multi-agent requires active Plus access; check your dashboard for the current entitlement.

## Get started

Open **Settings → Copilot → Basic → Agents**. Configure an agent below, then choose the **Default backend** for new sessions.

### opencode (recommended)

In the **opencode** tab:

1. Click **Download opencode** to let Copilot install and manage it.
2. If opencode is already installed, click **I already have it**. If detection fails, **Configure** appears; open it, choose **My own binary**, then auto-detect again or apply an absolute path.
3. Choose a **Default model** and enable any other models you want in the picker.

Give opencode model access in either of these ways:

- **Copilot-hosted models:** add your license under **Basic → Copilot License**. Eligible models then appear without another API key.
- **Your key or local model:** open **Settings → Copilot → BYOK**, click **Add a provider**, and configure its models. Keys are stored in the Obsidian Keychain. opencode supports configured cloud providers and OpenAI-compatible endpoints such as Ollama or LM Studio.

### Claude Code

Open **Basic → Agents → Claude → Configure**, then click **Auto-detect** or enter the absolute path to `claude`. Click **Sign in** if needed.

Copilot requires Claude Code 2.1.206 or newer and uses the CLI's existing login. Claude models come from Claude Code, not the BYOK tab.

### Codex

Codex needs the Codex CLI and its ACP adapter:

1. Install Codex and run `codex login`.
2. Open **Basic → Agents → Codex → Configure**.
3. Install `codex-acp` with the command shown there.
4. Click **Auto-detect**, or enter its absolute path and click **Apply**.

Copilot uses the Codex CLI login. Codex models come from your Codex account, not the BYOK tab.

### Open Agent chat

Click the **Agent** ribbon icon or run **Open Copilot Agent Chat Window** from the command palette. If no ready default exists, **Select your agent** appears. Configure an agent; when it becomes ready, Copilot may open it automatically. If the chooser remains, select its **Installed** row and click **Start chat**.

## Work in Agent chat

- Click **+** for another session. Each tab keeps its own conversation, draft, attachments, and queued follow-ups. Right-click a tab to rename or close it.
- Use **New Chat** to reset the current tab. Use **Recent Chats** on Agent Home, or **Chat History** during a conversation, to resume saved work.
- Before the first message, you can switch an empty session to another installed agent without losing the draft. After chat history exists, that session stays with its agent.
- Add the active note, selected text, other notes, the active Copilot web tab, or supported images. You can also mention a note with `[[Note title]]`.
- Hover the small ring next to the send controls to see how full the conversation's context window is. When your account has usage limits the agent can report — such as a 5-hour or weekly cap on a subscription plan — the same panel shows how much of each limit is used and when it resets. If your setup has no such limits (for example, your own API key), no limit rows appear.

Type `/` to insert an enabled skill or [custom command](custom-commands.md). For a small question without opening Agent chat, use [Quick Ask](custom-commands.md#quick-ask).

## Projects

In Agent chat, open **Projects** and choose **New project** for work that needs a stable scope. A project keeps its own chats, context, files, and `AGENTS.md` instructions. Vault instructions still apply; the project file can add more specific rules.

If project context is still being prepared, Copilot queues your message until it is ready. See [Projects](projects.md) for setup details.

## Permissions and safe use

The mode picker shows only modes supported by the current agent:

- **Default** asks before sensitive work. For example, opencode asks before shell commands and file edits.
- **Plan** is read-only planning and appears only when supported.
- **Auto** reduces or removes prompts. Use it only for agents and requests you trust.

Claude's **Auto mode permissions** setting controls whether Auto judges risk, accepts edits, or bypasses all checks. opencode supports Default and Auto, but not Plan. Codex modes depend on its adapter.

When approval is needed, an inline **Permission required** card shows the diff or tool inputs. Choose one of the one-time or persistent allow/deny options offered by the agent. Cancelling the turn cancels unanswered requests.

The vault or project is a working directory, not a security sandbox. Auto or bypass modes may reach other files and services available to your account. Prefer Default for unfamiliar work and review persistent permissions carefully.

## Multi-agent answers

With active Plus access, type `@` and mention installed agents in one prompt. Copilot sends the same question and context to them in parallel, then the current agent summarizes their answers.

This flow is for read-only research and review. Temporary agents may read, search, and use safe retrieval skills, but Copilot blocks vault writes and unknown tools. Use a normal single-agent turn to change files.

## Skills shared across agents

Skills are reusable instruction packets built around a `SKILL.md` file. To share one:

1. Open **Settings → Copilot → Skills**.
2. Toggle its agent icons for opencode, Claude, or Codex.
3. Type `/` in Agent chat, or describe the task and let the agent choose an enabled skill.

Shared skills live under `<Copilot folder>/skills/`. Copilot links them into `.opencode/skills/`, `.claude/skills/`, or `.agents/skills/`. It also discovers skills already in those native folders and can migrate duplicate copies into the shared folder.

Built-in skills cover Obsidian Markdown, Bases, Canvas, and the Obsidian CLI. An active paid license adds cloud-backed skills for web research, PDF reading, YouTube transcripts, and X posts.

On Windows, creating skill links may require **Developer Mode** or administrator access. If sync replaces a link, toggle that agent off and on to recreate it.

## Related

- [Getting Started](getting-started.md)
- [Projects](projects.md)
- [Custom Commands](custom-commands.md)
- [Paid Plans and Self-Host](copilot-plus-and-self-host.md)
- [Windows Setup for Agent](agent-mode-windows-setup.md)
