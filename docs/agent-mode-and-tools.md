# Agent Mode and Tools

Copilot Plus includes an **autonomous agent** that can reason step-by-step and decide which tools to use to answer your question. Instead of you specifying every step, the agent figures out what to do on its own.

This feature requires a [Copilot Plus](copilot-plus-and-self-host.md) license.

---

## Overview

When the autonomous agent is enabled, Copilot can:

1. Break down your request into sub-tasks
2. Use tools to gather information (search your vault, search the web, read a note)
3. Create or edit notes
4. Combine results and give you a comprehensive answer

**Example**: Ask "What did I work on last week?" and the agent will automatically search your vault for dated notes from the past 7 days, read the relevant ones, and summarize your week.

---

## Enabling Agent Mode

1. Go to **Settings → Copilot → Plus**
2. Turn on **Enable Autonomous Agent**

The agent activates automatically when you're in **Copilot Plus** mode. You don't need to do anything special — just ask your question.

### Starting Agent Mode for the First Time

If the agent Copilot would normally start is not set up and there is no chat or runtime error to recover, Agent Mode opens with **Select your agent**. Each row shows what that agent uses and its current setup state:

- **Installed** can start a chat. Copilot checks sign-in after the agent starts.
- **Checking…** is temporarily unavailable while Copilot verifies the installation.
- **Update required** or **Error** opens Configure with the specific recovery guidance.
- A row without a status badge is not installed and opens Configure.

Selecting a row only previews its action. **Start chat** saves that agent as the default and starts it; **Configure** opens its setup without changing the default. After a chat starts, use the agent and model picker to switch agents or choose one of that agent's models.

### Choosing the OpenCode Binary Source

The OpenCode setup dialog (**Settings → Copilot → Agents → opencode → Configure**) offers two ways to provide the binary, shown one at a time: **Managed by Copilot**, where Copilot downloads and updates an official release for you, and **My own binary**, where you point Copilot at an OpenCode you already have installed.

Switching between the two views only changes which controls you see — it never changes the binary in use. The actual switch happens when you act: **Download & install** activates the managed copy, and applying a path under **My own binary** activates yours. Your saved custom path is kept while you browse the managed view, and the dialog tells you whenever the source you're looking at is not the one currently in use.

## Sample Prompts in the Message Box

When you open a new agent chat and the message box is empty, Copilot types out sample prompts there one at a time — each appears character by character, pauses so you can read it, clears itself, and gives way to the next. They are examples of what the agent can do with your vault, not something being sent.

- Press **Tab** while a suggestion is on screen to drop the whole prompt into the message box. Nothing is sent: edit it first, or press Enter to send it as-is.
- Start typing at any point and the suggestions disappear. Clear the box again and they come back.
- Once the conversation has started, the suggestions stop for that chat.

If you've turned on reduced motion in your operating system, the prompts still rotate but appear and disappear whole instead of typing out.

## Choosing an Operating Mode

The mode picker beside the message box controls how much the active agent can do:

- **Default** — the agent can work in your vault and asks before sensitive actions.
- **Plan** — the agent reads and reasons without changing your vault.
- **Auto** — the agent can work without individual approval prompts. Use it only when you trust the task and workspace.

The available modes depend on the selected agent. Copilot normalizes equivalent modes across supported versions of Claude, Codex, and OpenCode.

When **Default** mode asks for permission, the request stays in the chat until
you choose an action, cancel the turn, or close the session. Hover or focus a
persistent action to inspect its detailed permission rule.

### Switching Agents and Models

Changing the agent or model from the picker keeps the text and attachments currently in the message box. This lets you continue composing the same message after switching between Claude, Codex, and OpenCode. **New Chat** intentionally starts with an empty message box.

### Max Iterations

The agent works in iteration cycles (think → use a tool → think → use a tool → answer). You can control the maximum number of iterations before the agent stops:

- **Default**: 4 iterations
- **Maximum**: 16 iterations
- **Setting**: **Settings → Copilot → Plus → Autonomous Agent Max Iterations**

The agent also has a maximum runtime of 5 minutes per response, regardless of iteration count.

---

## Available Tools

Copilot Plus has 13 built-in tools. Some are always active; others can be enabled or disabled.

### Built-in Obsidian skills

Copilot also seeds four Obsidian-native skills for Claude, Codex, and OpenCode:

- **Obsidian Markdown** — wikilinks, embeds, block references, callouts, properties, tags, and comments.
- **Obsidian Bases** — valid `.base` schemas, filters, formulas, views, summaries, quoting, and date/duration behavior.
- **JSON Canvas** — the `.canvas` schema, nodes, edges, groups, layout, colors, IDs, and link integrity.
- **Obsidian CLI** — runtime and indexed operations such as currently open notes and tabs, workspace layout, daily notes, typed properties, tasks, backlinks, Bases queries, template resolution, link-aware moves, registered commands, and plugin debugging.

These skills appear under **Settings → Copilot → Skills**, where each one can be enabled or disabled per agent. Existing choices are preserved when Copilot refreshes a built-in skill.

The Obsidian CLI skill first verifies that the CLI's `version` command succeeds. When available, Copilot passes the platform-specific CLI executable from the running Obsidian installation directly to the agent, so this probe does not depend on the backend's `PATH`. The CLI still requires a compatible Obsidian installer and a running Obsidian app; if it is unavailable, the agent falls back to normal filesystem operations where possible. Copilot does not change its minimum supported Obsidian version or attempt to install or repair the CLI.

When inspecting open tabs, the agent preserves Markdown notes, other file-backed tabs, and non-file views as workspace context. It reads content only from explicit vault paths reported by Obsidian and never treats a tab title or ID as a filename.

The agent never reloads or restarts Obsidian, nor does it reload, disable, or uninstall the Copilot plugin hosting its session. Those actions terminate in-flight agent work. When a reload is required to finish verification, the agent leaves it for you to perform after the session ends. Reloading a different plugin remains available for plugin development.

### Web and document routing

Claude, Codex, and OpenCode choose between vault and web evidence from the question. They search the vault first for questions about your own notes. For current facts, external topics, and third-party documentation, they can proactively search the web without requiring an explicit “search the web” instruction. A weak or empty vault search can also lead to web research when the question is external in nature.

Web research normally starts with one discovery search followed by targeted page fetches. The agent does not put text from your vault into a web query unless your request clearly requires researching that text.

For PDF and EPUB files, the **Document Processor** choice under **Settings → Copilot → Miyo** also controls Agent Mode:

- **Plus** uses the Copilot Plus PDF reader and can fall back to another available document-reading tool.
- **Miyo** parses PDF and EPUB files locally, including files outside the vault. Copilot removes the Plus PDF skill from the agent's skills folder while this is selected, so a document cannot reach a cloud parser by mistake. If local parsing fails, the agent reports the error and stops.

Unlike chat, Agent Mode parses through the Miyo CLI rather than the Miyo server, so the Miyo option needs the app installed on the same machine as Obsidian; a remote Miyo server does not enable it. Without a local install, either install Miyo or set Document Processor back to **Plus**. Switching between the two reseeds the skills folder and restarts running agents, so either choice applies without a reload.

### Publish to Symposium

Ask Claude, Codex, or OpenCode to publish an existing Markdown note as a web page. The agent finishes a self-contained HTML document, including static Mermaid and Bases output, before handing it to Copilot. Copilot rejects scripts, forms, frames, handlers, redirects, executable URLs, externally loaded assets, and CSS resource URLs before consuming the staged file. It then shows the source note, title, size, fingerprint, and a link that opens a sandboxed rendering of those exact captured bytes in your default browser. The full-page preview remains scrollable, but navigation, context menus, dragging, and submissions are blocked. Return to Obsidian after reviewing the page; nothing is sent to Symposium until you explicitly confirm.

Ask the agent to delete, remove, or withdraw an existing Symposium page to open the same host-owned management flow without generating HTML. Copilot reads the note's current identity, then you choose **Delete** in Obsidian; the agent cannot supply the action or document id. The public URL itself is not a deletion interface.

When staged HTML fails validation, Copilot leaves that file in place and reports every actionable issue in one bounded message. The agent may correct that same file and retry once; it does not create new filenames or repeatedly simplify unrelated styling.

Copilot removes each agent-staged artifact as soon as it captures the reviewed bytes and removes the temporary browser preview when the review ends. It verifies that the local preview still matches the captured payload immediately before publishing. Canceling the review, asking the agent to regenerate, changing the preview file, or encountering a later failure sends nothing. Regenerated HTML is a new handoff and must pass through a fresh review. Copilot reads the source note's current `symposium` property itself: a note without an identity creates a page, while a note with a valid identity can only update that page. A failed update never creates a replacement page or changes the existing identity.

After a successful publish or update, Copilot appends the receipt to `.symposium/publish-history.md` and stores or preserves the full public link in the source note's `symposium` property. Use **Publish file to Symposium** to withdraw the page.

The Symposium skill does not give the agent a Symposium credential or API endpoint. Agent Mode still passes the raw `COPILOT_PLUS_LICENSE_KEY` to agent processes for other Copilot Plus relay tools; removing that broader exposure is tracked separately in [logancyang/obsidian-copilot-preview#105](https://github.com/logancyang/obsidian-copilot-preview/issues/105).

### Always-Enabled Tools

These tools are always available and cannot be disabled:

#### Get Current Time

Gets the current time in any timezone. Useful for time-aware queries like "what should I do today?"

#### Get Time Range

Converts natural time expressions (like "last week" or "yesterday") into exact date ranges. Usually called automatically before a time-based vault search.

#### Get Time Info

Converts an epoch timestamp to a human-readable date and time.

#### Convert Timezones

Converts a time from one timezone to another. Ask: "What time is 3pm EST in Tokyo?"

#### Read Note

Reads the content of a specific note. The agent uses this to inspect a note it found via search, or that you mentioned explicitly. Works on large notes by reading them in chunks.

#### File Tree

Browses the file structure of your vault. The agent uses this to find folder paths before creating new notes or to count files in a folder.

#### Tag List

Lists all tags in your vault with usage statistics. Useful for tag reorganization or finding notes by tag patterns.

#### Update Memory

Saves information to your memory when you explicitly ask the AI to remember something. See [Copilot Plus and Self-Host](copilot-plus-and-self-host.md#memory-system) for details.

> **Requires**: **Settings → Copilot → Plus → Reference Saved Memories** must be enabled. If this setting is off, the tool is not registered and memory commands will not work.

### Configurable Tools

These tools can be individually enabled or disabled in **Settings → Copilot → Plus → Tool Settings**:

#### Vault Search

Searches your vault notes by content. The agent uses this to find notes relevant to your question.

- **Trigger**: Automatically for vault-related questions, or explicitly with `@vault`
- **Uses**: Both semantic search (if enabled) and lexical search

#### Web Search

Searches the internet for current information.

- **Trigger**: Automatically when your question implies web/online content, or explicitly with `@websearch` or `@web`
- **Requires**: A web search service configured (Firecrawl or Perplexity in self-host mode, or handled by Plus)

#### Write to File

Creates a new note or overwrites an existing one entirely.

- **Trigger**: Automatically for "create a note" requests, or explicitly with `@composer` (available in both Copilot Plus and Projects mode)
- **Behavior**: Shows a preview of the content before writing. You can review and accept or reject the change.
- **Auto-accept**: Enable **Settings → Copilot → Plus → Auto-accept edits** to skip the preview

#### Replace in File

Makes targeted changes to an existing note using search-and-replace blocks.

- **Use case**: Small edits (adding a bullet, updating a section) — more precise than rewriting the whole note
- **Behavior**: Shows a diff preview before applying the change
- **Auto-accept**: Same setting as Write to File

#### YouTube Transcription

Fetches the transcript of a YouTube video.

- **Trigger**: Automatically when you paste a YouTube URL in your message
- **No extra setup needed**: Just include the URL in your message
- **Self-host option**: Use your own Supadata API key for transcription in self-host mode

---

## Tool Settings

Go to **Settings → Copilot → Plus → Tool Settings** to:

- See all available tools
- Enable or disable individual configurable tools
- View what each tool does

---

## Using Tools Explicitly

While the agent automatically decides when to use tools, you can also trigger them explicitly with @-mentions:

```
@vault find all notes about my reading list
@websearch what is the latest version of Python?
@composer create a new meeting notes template
@memory remember that I prefer bullet points for lists
```

See [Context and Mentions](context-and-mentions.md) for the full @-mention reference.

---

## Tool Call Indicators

While the agent is working, the chat shows what it is doing. A single action gets its own status line, such as:

- "Reading files"
- "Searching the web"
- "Reading file tree"
- "Compacting"

When the agent performs several actions in a row, they are collapsed into one summary row instead of a long list — for example "Read 2 files, ran 5 commands, thought for 51s". While that work is still in progress, the current step (like the command being run) appears beneath the summary and updates as the agent moves on.

Click a summary row to expand it and see every action inside, each with its own status line. An expanded row stays open — even as new actions stream into it — until you collapse it again.

Only background work is grouped this way. The agent's own messages, plan checklists, questions to you, and delegated sub-agents always stay visible as separate rows.

### Delegated Agents and Shell Commands

For v4, Claude runs delegated agents and Bash commands synchronously. Copilot waits for each supported tool to finish within the current response so the result arrives predictably before the turn ends. This temporarily favors reliable completion over parallel background execution.

The Workflow tool and remote-isolated agents are temporarily unavailable because they require background execution. Local agents, including worktree-isolated agents, remain available and run synchronously. Background execution will return after Copilot moves Claude sessions to a persistent streaming lifecycle.

This requires Claude Code 2.1.206 or newer. Copilot checks the installed version when it starts and whenever you apply or auto-detect a Claude binary. An older binary is marked **Incompatible version** in Settings → Copilot → Agents → Claude and cannot start a session. If you select Claude in chat, Copilot shows the required version and a **Configure Claude** button that opens the same setup dialog; installation guidance stays in that dialog.

If Claude's usage is exhausted, Copilot shows Claude's own error in chat, including the reset time when Claude provides one. You can wait until the limit resets or switch to another agent.

---

## File Editing: Preview and Diff

When the agent uses **Write to File** or **Replace in File**, it shows a preview before making changes:

- **Split view**: Before/after shown side by side
- **Side-by-side view**: Changes highlighted inline

In Agent Mode, the activity trail names the target of a single-file edit and shows a file count when one action changes multiple files.

You can choose your preferred diff view in **Settings → Copilot → Plus → Diff View Mode**.

Review the proposed change and click:

- **Accept** — Apply the change to your note
- **Reject** — Discard without making any changes
- **Revert** — Undo a change that was already accepted

### Auto-Accept Edits

If you trust the agent and don't want to review every file change, enable **Auto-accept edits** in **Settings → Copilot → Plus**. File changes will be applied immediately without a confirmation step.

---

## Reporting an Issue

When something goes wrong in Agent Mode, the **Report an Issue** button under **Settings → Copilot → Advanced → Agent Mode debugging** bundles everything a maintainer needs to diagnose it.

Clicking it opens a short form where you describe what happened. When you submit, Copilot:

1. Saves a screenshot of the **Agent Mode chat pane** (just the agent panel, not your whole screen).
2. Saves a recent **Agent Mode log** of the behind-the-scenes messages between Copilot and the agent. This log is captured automatically so a report always has recent activity to include; you can turn it off under **Settings → Copilot → Advanced → Keep an Agent Mode activity log**.
3. Opens the folder containing those files in your file manager.
4. Opens a prefilled GitHub issue in your browser.

The files are **not uploaded for you** — drag them from the opened folder into the GitHub issue to attach them.

> **Privacy note:** The Agent Mode log can contain your prompts, note contents, and tool inputs/outputs in plaintext. Review the saved files before sharing them publicly.

### Including the OpenCode log

When the **OpenCode** backend is active, the form shows an optional checkbox to include OpenCode's own log. It is **off by default** because OpenCode's log is shared across all of your OpenCode sessions, so it may contain activity from unrelated projects. Turn it on only when the issue involves the OpenCode backend itself.

This feature is available on desktop only.

---

## Related

- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — Licensing and memory
- [Vault Search and Indexing](vault-search-and-indexing.md) — How vault search works
- [Context and Mentions](context-and-mentions.md) — @-mention triggers for tools
