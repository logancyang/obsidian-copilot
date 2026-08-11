# Agent Mode and Tools

Agent Mode is Copilot's dedicated desktop workspace for tasks that need more than a single chat response. It connects Obsidian to a supported coding agent, which can inspect your vault, use its own tools and skills, and make changes with the permissions you choose.

A single-agent chat does **not** require Copilot Plus. You need one supported agent and whatever account or model access that agent requires. Copilot Plus adds [multi-agent work and relay-backed skills](copilot-plus-and-self-host.md#agent-mode-and-copilot-plus).

Agent Mode is available in the desktop app, not on mobile.

---

## Open Agent Mode

- Click the **Agent** icon in the left ribbon.
- Or run **Open Copilot Agent Chat Window** from the command palette.

Agent Mode is a separate view from [Quick Chat](chat-interface.md). The Chat, Vault QA, Copilot Plus, and Projects modes in Quick Chat continue to work independently.

On first use, Agent Mode asks you to select and configure an agent:

- **OpenCode** — recommended. Copilot can download and manage OpenCode for you, or use an existing installation.
- **Claude** — uses Claude Code and your Anthropic sign-in.
- **Codex** — uses Codex and your OpenAI sign-in.

An **Installed** agent can start. **Update required** or **Error** opens setup with recovery guidance. Selecting an unconfigured agent opens its setup without changing your default until you start a chat.

After the chat starts, use the picker beside the message box to change the agent or model. Your draft message and attachments stay in place when you switch. **New Chat** starts with an empty message box.

### Configure OpenCode

Open **Settings → Copilot → Basic → Agents → OpenCode**.

- Choose **Download OpenCode** to let Copilot install and update an official release.
- Choose **I already have it** to find an installation on your computer or enter its path.

Looking at a different source in the setup dialog does not switch the active binary. The switch happens only when you install the managed copy or apply your own binary path.

### Configure Claude or Codex

Install the corresponding command-line agent, sign in, then open **Settings → Copilot → Basic → Agents** and configure its binary. Windows users can follow [Windows Setup for Agent Mode](agent-mode-windows-setup.md).

Claude Agent Mode requires Claude Code 2.1.206 or newer. Copilot marks an older installation as incompatible and links back to the setup dialog.

---

## Choose an Operating Mode

The mode picker beside the message box controls what the active agent may do:

- **Default** — works in your vault and asks before sensitive actions.
- **Plan** — reads and reasons without changing your vault.
- **Auto** — works with the automatic permissions configured for that agent. Some actions can still require approval.

Available modes vary by agent. Copilot remembers the last mode used with each agent.

For Claude, configure **Auto mode permissions** under **Settings → Copilot → Basic → Agents → Claude**:

- **Auto** — Claude approves routine work and asks about risky actions.
- **Accept edits** — file edits are approved automatically; other actions still ask.
- **Bypass permissions** — skips permission checks. Use only in a vault and environment you fully trust.

When Agent Mode asks for permission, the request remains in the chat until you answer, cancel the turn, or close the session.

### Sign in to Claude

The Claude setup dialog can sign you in before a chat starts. After confirming or auto-detecting the Claude Code binary, click **Sign in** to open Claude's browser login. If the CLI cannot open the browser itself, click **Open sign-in page** while sign-in is running to use the fallback URL.

### Set a default model and effort

Under **Settings → Copilot → Basic → Agents**, each enabled agent can use a default model and effort for new chats. **Default effort** stays selected when you switch models. If a model does not offer effort levels, the control is disabled and shows **Not supported**.

## Sample Prompts in the Message Box

When you open a new agent chat and the message box is empty, Copilot types out sample prompts there one at a time — each appears character by character, pauses so you can read it, clears itself, and gives way to the next. They are examples of what the agent can do with your vault, not something being sent.

- Press **Tab** while a suggestion is on screen to drop the whole prompt into the message box. Nothing is sent: edit it first, or press Enter to send it as-is.
- Start typing at any point and the suggestions disappear. Clear the box again and they come back.
- Once the conversation has started, the suggestions stop for that chat.

If you've turned on reduced motion in your operating system, the prompts still rotate but appear and disappear whole instead of typing out.

## Turn Duration

While an agent turn is running, the activity trail shows **Worked for** with a live elapsed-time counter and the animated Copilot icon. The counter measures the full wall-clock time from sending the prompt until the turn finishes, including tool use and any time spent waiting for a permission or answer.

While a reasoning step is active, its brain row shows an animated ellipsis rather than a second timer. When that step finishes, the row changes to **Thought for** with its frozen duration.

When the turn finishes, the time freezes and the Copilot icon becomes static. The completed duration moves to the leading edge of the same footer row as the response controls. When a duration is unavailable, the message timestamp appears in that position instead; only one of the two is shown. The duration remains visible until you send the next prompt, when that completed response falls back to its timestamp and the new turn owns the live counter. Leading zero units are omitted, so durations appear as `18s`, `2m 18s`, or `1h 2m 18s`.

> The **Autonomous Agent Max Iterations**, **Tool Settings**, diff preview, and auto-accept controls under the Plus settings belong to the legacy Copilot Plus mode in Quick Chat. They do not limit or configure a dedicated Agent Mode session.

---

## Add Context

Agent Mode can receive:

- the active note;
- notes you select or mention;
- selected text;
- the active Copilot web tab;
- images when the chosen model supports vision; and
- project context when you open an [Agent Mode project](projects.md).

Use the context controls above the message box, drag in an image, or mention a note with `[[Note Title]]`. Type `/` to use custom commands and available skills.

The `@vault`, `@websearch`, `@composer`, and `@memory` tool mentions are controls for Copilot Plus mode in Quick Chat. In Agent Mode, the selected agent decides when to use its native tools and installed skills.

---

## Skills and Tools

Claude, Codex, and OpenCode bring their own tools for reading files, searching, running commands, and editing. Copilot also seeds skills that teach them how to work safely with Obsidian.

Manage skills under **Settings → Copilot → Skills**. Each skill can be enabled or disabled per agent, and Copilot preserves those choices when it updates a built-in skill.

### Built-in Obsidian skills

- **Obsidian Markdown** — wikilinks, embeds, block references, callouts, properties, tags, and comments.
- **Obsidian Bases** — `.base` files, filters, formulas, views, summaries, quoting, and dates.
- **JSON Canvas** — `.canvas` nodes, edges, groups, layouts, colors, IDs, and links.
- **Obsidian CLI** — the current workspace, open tabs, daily notes, properties, tasks, backlinks, Bases queries, templates, link-aware moves, commands, and plugin debugging.

The Obsidian CLI skill requires a compatible Obsidian installation and a running desktop app. If the CLI is unavailable, the agent falls back to normal file operations where possible. The agent will not reload Obsidian or disable, uninstall, or reload the Copilot plugin while it is hosting the session.

### Web and document skills

Agents choose between vault and web evidence based on your request. They normally search your vault for questions about your notes and the web for current or external information. Copilot never intentionally adds text from your vault to a web query unless your request requires researching that text.

Copilot Plus can provide relay-backed skills for web search and fetch, PDF reading, YouTube transcripts, and X posts. Without a license, the agent can use its native alternatives when available.

For PDF and EPUB files, **Settings → Copilot → Miyo → Document Processor** also applies to Agent Mode:

- **Plus** uses the Copilot Plus document reader, with another available reader as a fallback.
- **Miyo** parses documents locally. It requires the Miyo app on the same computer as Obsidian; a remote Miyo server is not enough for Agent Mode document parsing.

When Miyo is selected, Copilot removes the cloud PDF skill so the document is not sent to that parser accidentally. Changing the processor restarts running agents so the new choice takes effect.

### Publish to Symposium

Ask the agent to publish an existing Markdown note as a web page. It prepares a self-contained HTML page, and Copilot validates it and opens a sandboxed preview. Nothing is published until you confirm in Obsidian.

After a successful publish, Copilot stores the public link in the note's `symposium` property and records the receipt in `.symposium/publish-history.md`. Ask the agent to update or withdraw the same page, or run **Publish file to Symposium** yourself. See [Getting Started](getting-started.md#publish-a-note-to-symposium) for the manual workflow.

---

## Follow the Agent's Work

While the agent is running, Agent Mode shows activity such as reading files, searching, running commands, thinking, and compacting context. Consecutive background actions collapse into a summary row; open it to inspect the details. Agent messages, plans, questions, and delegated agents remain separate.

The **Worked for** timer covers the full turn, including tool use and time waiting for your answer. Finished reasoning rows show **Thought for** with their own duration.

In the current Claude integration, delegated local agents and shell commands run synchronously. Workflow and remote-isolated background agents are temporarily unavailable. If Claude reports that its usage is exhausted, wait for its reset time or switch agents.

---

## Report a Problem

Open **Settings → Copilot → Advanced → Agent Mode debugging** and choose **Report an Issue**. Copilot saves a screenshot of the Agent Mode pane and a recent activity log, opens their folder, and opens a prefilled GitHub issue. The files are not uploaded automatically.

Review the files before attaching them: the activity log can contain prompts, note content, and tool inputs or outputs. OpenCode's own shared log is optional and off by default because it can include activity from unrelated OpenCode sessions.

---

## Related

- [Getting Started](getting-started.md) — Install Copilot and start your first chat
- [Context and Mentions](context-and-mentions.md) — Control what information Copilot receives
- [Projects](projects.md) — Give Agent Mode reusable project context and instructions
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — Licensing, models, and relay-backed features
