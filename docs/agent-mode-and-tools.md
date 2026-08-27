# Agent Chat

Agent Chat is the default Copilot experience on desktop. It gives an AI agent a working view of your vault so it can answer questions, use tools, and make permissioned changes while you follow the work in chat.

Quick Chat remains available for lightweight conversation and is the main chat experience on mobile. For multi-step work, Projects, Skills, or file changes, start with Agent Chat.

## Choose an agent

Open [**Settings → Copilot → Basic → Agents**](settings.md#basic). Configure at least one agent, then choose the **Default backend** for new chats.

| Agent        | Best starting point                             | Where model access comes from                                              |
| ------------ | ----------------------------------------------- | -------------------------------------------------------------------------- |
| **opencode** | Recommended for most people                     | Copilot-hosted models, your API providers, or local OpenAI-compatible APIs |
| **Claude**   | You already use Claude Code                     | Your Claude Code installation and Anthropic account                        |
| **Codex**    | You already use the Codex CLI and Codex account | Your Codex CLI login through the `codex-acp` adapter                       |

A one-agent chat can work without a Copilot license when you bring your own model access. An eligible paid plan adds Copilot-hosted models and cloud-backed features. [Compare Copilot plans](copilot-plus-and-self-host.md).

### opencode

opencode is the most flexible choice because it can use Copilot-hosted, BYOK, and local models.

1. In the **opencode** tab, click **Download opencode** to let Copilot install and manage it.
2. If you already installed it, click **I already have it**. If detection fails, open **Configure**, choose **My own binary**, then auto-detect it or enter the absolute path.
3. Enable the models you want to see and choose a **Default model**.

There are three ways to provide model access:

- **Copilot-hosted:** add your license under **Basic → Copilot License**. Models included with your plan appear automatically.
- **Your API key:** open [**Settings → Copilot → BYOK**](settings.md#byok), add a provider, and configure its models. Copilot stores supported secrets in the Obsidian Keychain.
- **Local:** add an OpenAI-compatible endpoint from software such as Ollama or LM Studio under **BYOK**.

### Claude

The Claude backend runs through Claude Code on your computer:

1. Open **Basic → Agents → Claude → Configure**.
2. Select **Auto-detect**, or enter the absolute path to the `claude` executable.
3. Select **Sign in** if Claude Code is not already authenticated.
4. Enable the models you want and choose a default.

Claude models and billing come from your Claude Code account. Models added under **BYOK** do not join the Claude model list.

### Codex

The Codex backend needs the Codex CLI and its `codex-acp` adapter:

1. Install the Codex CLI and run `codex login`.
2. Open **Basic → Agents → Codex → Configure**.
3. Run the adapter installation command shown in the dialog.
4. Select **Auto-detect**, or enter the absolute path to `codex-acp` and select **Apply**.
5. Enable the models you want and choose a default.

Copilot uses your existing Codex CLI login. Models added under **BYOK** do not join the Codex model list.

For Windows-specific installation help, see [Windows setup for Agent Chat](agent-mode-windows-setup.md).

### Start a chat

Select the **Agent Chat** ribbon icon or run **Open Copilot Agent Chat Window** from the command palette. If the default agent is not ready, Copilot opens **Select your agent**. Configure an agent, choose an installed row, then select **Start chat**.

## Models, effort, and permissions

Each agent has its own model list. The models shown in one agent do not automatically appear in another.

- Set the model and effort used by new chats under [**Settings → Copilot → Basic → Agents**](settings.md#basic).
- Use the controls beside the composer to change the model or effort for the current chat.
- Before the first message, choosing a model from another installed agent switches the empty chat to that agent. Once a conversation has started, it stays with its agent.
- **Effort** appears only when the selected agent and model support it. Higher effort can improve difficult reasoning but may take longer and use more of your account allowance.

The permission picker shows only choices supported by the current agent:

| Choice      | What it does                                                                        |
| ----------- | ----------------------------------------------------------------------------------- |
| **Default** | Uses the agent's normal approval behavior and is the safest starting point          |
| **Plan**    | Prepares a read-only plan before edits when the current agent supports this choice  |
| **Auto**    | Reduces approval prompts according to the current agent's automatic permission rule |

opencode supports **Default** and **Auto**. Claude supports **Default**, **Plan**, and **Auto**. Codex shows the choices supported by the installed adapter. Claude also has an **Auto mode permissions** setting that controls how much Auto may approve.

When an action needs approval, Agent Chat displays a **Permission required** card with the proposed change or tool input. Choose one of the temporary or persistent allow or deny options offered by that agent. Stopping the turn cancels unanswered requests.

When an agent asks a set of questions, answer the current tab and select **Next**. On the final tab, **Submit** becomes available after every question has an answer. You can use the tabs to review or skip ahead; **Cancel** declines the entire request.

Your vault or project is the agent's working directory, not a security sandbox. Auto or bypass permissions can reach other files and services available to the agent or your account. Use **Default** for unfamiliar work and review persistent permissions carefully.

## Context and history

Agent Chat keeps each conversation separate:

- Select **+** for another session. Each tab keeps its own history, draft, attachments, and queued follow-ups.
- Select **New Chat** to reset the current tab.
- Use **Recent Chats** from the Agent Chat home screen, or **Chat History** inside a conversation, to resume saved work.
- Add the active note, selected text, other notes, folders, a Copilot Web Viewer tab, or supported images. You can also mention a note with `[[Note title]]`.
- Hover the context ring beside the send controls to see how much of the model's context window is in use. If the connected account reports usage limits, the same panel shows the available limit and reset time.

Attachments apply to the next message. For instructions and context that should be reused, create a [Project](projects.md) or add rules to [`AGENTS.md`](system-prompts.md). See [Context and Mentions](context-and-mentions.md) for every context option.

Type `/` to insert an enabled Skill or [Copilot command](custom-commands.md). For a quick question or rewrite beside the current selection, use [Quick Ask](custom-commands.md#quick-ask).

## Multi-agent answers

With active Plus access, type `@`, open **Agents**, and mention one or more other installed agents in the same prompt. Copilot sends the same question, that turn's attachments, and a bounded slice of the visible conversation to each mentioned agent in parallel. The current agent summarizes their answers; it does not automatically produce a separate answer of its own.

This is useful for research, second opinions, and reviews. Mentioning only the current agent behaves like a normal turn.

Each answer appears in its own tab, with **Summary** first. If one answerer fails, Copilot keeps the successful answers and summarizes what completed.

Multi-agent answers are designed for read-only research, not edits. Copilot denies explicit vault edit, delete, and move tools, along with tools it cannot classify. Retrieval Skills can still run their own scripts under the agent's permissions, so multi-agent answers are not a security sandbox. Use only trusted Skills, and use a regular single-agent turn when you want files changed.

The default model and effort saved for each mentioned agent are used for its answer. If an agent is not installed or ready, configure it before adding it to the prompt.

## Skills across agents

Skills are reusable instruction packets built around a `SKILL.md` file. One Skill can be made available to opencode, Claude, and Codex without maintaining three copies.

1. Open [**Settings → Copilot → Skills**](settings.md#skills).
2. Find a Skill and toggle the opencode, Claude, or Codex icons for the agents that should use it.
3. Type `/` in Agent Chat to choose it, or describe the task and let the agent select an enabled Skill.

Shared Skills live under `<Copilot folder>/skills/`. Copilot links them into the native folders used by each agent: `.opencode/skills/`, `.claude/skills/`, and `.agents/skills/`. Skills already present in those native folders also appear in the settings list.

Custom Skills and built-in Obsidian Skills are free. Active Plus access adds cloud-backed Skills for web research, PDF reading, YouTube transcripts, X posts, and Symposium.

In Self-Host Mode with OpenCode selected, Agent Chat's built-in web-search Skill uses the search provider selected under **Settings → Copilot → Self-Host**. Provider credentials stay inside Obsidian rather than being passed to OpenCode, and the feature does not require Obsidian's command line interface. Copilot disables OpenCode's native web-search and web-fetch tools so they cannot bypass that route. Full-page web fetching is unavailable through OpenCode in Self-Host Mode because the supported search providers do not share a page-fetch interface; Agent Chat can still use the configured provider's search results.

On Windows, creating the folder links may require **Developer Mode** or administrator access. If a sync service replaces a link, toggle that Skill off and on for the affected agent to recreate it.

## Related

- [Getting Started](getting-started.md)
- [Models, Effort, and Permissions](models-and-parameters.md)
- [Projects](projects.md)
- [Instructions for Agent Chat and Quick Chat](system-prompts.md)
- [Copilot Commands and Quick Ask](custom-commands.md)
- [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md)
