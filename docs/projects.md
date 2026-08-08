# Projects

Projects are focused AI workspaces. Each project has its own instructions, context sources, and
isolated chat history. Use projects to keep separate AI conversations per client, topic, or area
of work.

Projects support **50+ file types** beyond markdown, including PDFs, Word documents, PowerPoint, Excel, images, and more — making them ideal for analyzing large or diverse document collections.

> **Note**: Projects is an alpha feature. It may have rough edges and is subject to change.

---

## Overview

In regular chat, all conversations share the same settings and model. Projects let you create dedicated workspaces with:

- **A specific context** — Specific notes, folders, URLs, or YouTube videos the AI always has access to
- **A dedicated model** — Different projects can use different AI models
- **Project instructions** — Each Agent Mode project can have its own `AGENTS.md`
- **Isolated chat history** — Conversations in one project don't mix with conversations in another

**Example use cases:**

- A "Research" project that always has your research notes as context
- A "Client Work" project with a specific system prompt and access to client-related notes
- A "Learning" project with YouTube video URLs for study materials

---

## Creating a Project

1. Open the chat panel
2. Click the mode selector at the top of the chat
3. Select **Projects (alpha)**
4. Click **New Project** (or the `+` button)
5. Fill in the project details and save

---

## Project Configuration

Each project has the following settings:

### Name

A short name for the project. Appears in the project list.

### Description

An optional description of what the project is for.

### Model

Choose which AI model to use for this project. The available options are the models enabled under
**Settings → Copilot → Basic → Agents → Quick Chat models**.

### Model Settings

Override the default temperature and max tokens specifically for this project.

### Agent Mode Instructions

Open the project info popover and select **AGENTS.md**. This opens the real file in Obsidian; there
is no separate prompt editor in project settings.

Vault instructions apply first, followed by the project's `AGENTS.md`, so project rules take
precedence. For an older project without `AGENTS.md`, the file is initialized from the Project
System Prompt already stored in `project.md` — the first time you open it, or automatically when
you next start a chat in that project, so existing projects keep working without any migration
step. A legacy Copilot-generated mirror is converted to that same text; user-authored files are
left alone, and a project with no instructions gets no file at all.

`project.md` remains the project's metadata and context configuration record. It is not the agent
instruction file and is not renamed or migrated.

---

## Context Sources

Projects let you pre-load context that is always available in the project's chat.

### File Inclusions and Exclusions

Specify which notes or folders to include in this project's context. You can include by:

- **Tag** (e.g. `#research`) — all notes with that frontmatter tag. Expanded at query time, so new notes are included automatically.
- **Folder** (e.g. `daily/`) — all markdown files in the folder, recursively. Also expanded at query time.
- **Note link** (e.g. `[[Project Brief]]`) — a specific note, included verbatim. Use this for pinning a foundational document or README.
- **Extension** (e.g. `*.py`) — all files with that extension. Expanded at query time.
- **Property** (e.g. `[Topics:Physics]` or `[Subject:]`) — notes matching a frontmatter field. Syntax:
  - `[key:value]` — include notes where the property `key` equals `value` (case-insensitive, trimmed). A list property matches when any element matches.
  - `[key:]` — include notes that declare the property `key`, regardless of its value.

**Exclusions**: These notes/folders are excluded from context.

This scopes the AI's knowledge to just the notes relevant to your project.

### Web URLs

Add web page URLs that are fetched and included as context for every conversation in this project. Useful for documentation, reference pages, or web resources you frequently consult.

### YouTube URLs

Add YouTube video URLs whose transcripts are loaded into context for every conversation.

---

## Working in a Project

### Switching Projects

Use the project selector at the top of the chat panel to switch between projects. When you switch, the chat history clears and the new project's context loads.

### Isolated Chat History

Each project maintains its own chat history, completely separate from other projects and from regular (non-project) chat. Conversations don't bleed across projects.

### Context Loading

When you open a project, Copilot loads the configured context (notes, URLs, etc.) automatically. For large projects with many notes, this may take a moment.

---

## Project List Management

Go to the project selector to manage your projects:

- **Sort**: Projects can be sorted by most recently used or alphabetically
- **Edit**: Click the edit icon to change a project's settings
- **Delete**: Remove the project entry from the list (saved conversation files in your vault are not deleted)

Sort strategy: **Settings → Copilot → Basic → Project list sort strategy**

---

## Limitations

As an alpha feature, projects have some known limitations:

- Large context sources (many notes or large files) may slow down context loading
- The context loading on project switch is synchronous — the AI isn't available until loading completes
- Some features available in regular Plus mode may behave differently in projects
- Auto-compact behavior is the same as regular chat

---

## Related

- [Chat Interface](chat-interface.md) — Chat modes overview, new chat behavior, history
- [Instructions and System Prompts](system-prompts.md) — Vault and project instructions
- [Context and Mentions](context-and-mentions.md) — How context works
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — Plus features
