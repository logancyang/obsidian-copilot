# Projects

Projects are focused AI workspaces. Each project has its own model, system prompt, context sources, and completely isolated chat history. Use projects to keep separate AI conversations per client, topic, or area of work.

Projects support **50+ file types** beyond markdown, including PDFs, Word documents, PowerPoint, Excel, images, and more — making them ideal for analyzing large or diverse document collections.

> **Note**: Projects is an alpha feature. It may have rough edges and is subject to change.

---

## Overview

In regular chat, all conversations share the same settings and model. Projects let you create dedicated workspaces with:

- **A specific context** — Specific notes, folders, URLs, or YouTube videos the AI always has access to
- **A dedicated model** — Different projects can use different AI models
- **A custom system prompt** — Each project can have its own instructions for the AI
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
Choose which AI model to use for this project. The available options depend on which models you have enabled.

### Model Settings
Override the default temperature and max tokens specifically for this project.

### System Prompt
Set a custom system prompt for this project. This replaces (or supplements) the global default. See [System Prompts](system-prompts.md) for details.

---

## Context Sources

Projects let you pre-load context that is always available in the project's chat.

### File Inclusions and Exclusions

Specify which notes or folders to include in this project's context:

- **Inclusions**: Only these notes/folders are available for search and context
- **Exclusions**: These notes/folders are excluded from context

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
- **Delete**: Remove a project (its chat history is also cleared)

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
- [System Prompts](system-prompts.md) — Custom system prompts for projects
- [Context and Mentions](context-and-mentions.md) — How context works
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — Plus features
