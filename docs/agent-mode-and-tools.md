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

### Max Iterations

The agent works in iteration cycles (think → use a tool → think → use a tool → answer). You can control the maximum number of iterations before the agent stops:

- **Default**: 4 iterations
- **Maximum**: 16 iterations
- **Setting**: **Settings → Copilot → Plus → Autonomous Agent Max Iterations**

The agent also has a maximum runtime of 5 minutes per response, regardless of iteration count.

---

## Available Tools

Copilot Plus has 13 built-in tools. Some are always active; others can be enabled or disabled.

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

While the agent is working, the chat shows status indicators for each tool call:

- "Reading files"
- "Searching the web"
- "Reading file tree"
- "Compacting"

This lets you see what the agent is doing as it works.

---

## File Editing: Preview and Diff

When the agent uses **Write to File** or **Replace in File**, it shows a preview before making changes:

- **Split view**: Before/after shown side by side
- **Side-by-side view**: Changes highlighted inline

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
