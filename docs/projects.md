# Projects

Projects are focused AI workspaces with their own instructions, reusable context, and isolated chat history. Use them to separate work by client, topic, or area of responsibility.

Projects are an alpha feature and may change.

Projects can work with 50+ file types, including PDFs, Office documents, images, and source code. Copilot prepares supported binary project files with its hosted document service before the agent runs; this requires a Copilot license.

---

## Projects in Agent Mode

Open the dedicated Agent Mode view from the ribbon or run **Open Copilot Agent Chat Window**. Agent Home shows your projects; choose one or select **New Project**.

An Agent Mode project contains:

- a name and optional description;
- context sources that are prepared when the project opens;
- project-specific instructions in `AGENTS.md`; and
- chat history isolated from other projects and non-project chats.

Agent Mode uses the currently selected agent, model, and operating mode. It does not store a separate project model, temperature, or max-token override.

### Project instructions

Open the project info popover and select **AGENTS.md**, or edit **Project instructions** in the project dialog. Both surfaces edit the same file.

Vault-wide instructions apply first, followed by the project's `AGENTS.md`, so the project can add more specific rules. Copilot also keeps Claude's sibling `CLAUDE.md` pointed at `AGENTS.md`, letting Claude, Codex, and OpenCode share the same project instructions.

Older projects remain compatible. If an old project has a Project System Prompt but no `AGENTS.md`, Copilot moves those instructions into `AGENTS.md` when the project is opened or its next session starts. User-authored files are not replaced.

`project.md` remains the project's metadata and context record; it is not renamed into the instruction file.

### Context sources

Projects can prepare these sources for each conversation:

- **Tag**, such as `#research` — matching notes, expanded when the context is prepared.
- **Folder**, such as `daily/` — Markdown notes in that folder and its subfolders.
- **Note link**, such as `[[Project Brief]]` — one specific note.
- **Extension**, such as `*.py` — files with that extension.
- **Property**, such as `[Topics:Physics]` or `[Subject:]` — notes whose frontmatter value matches, or notes that declare the property.
- **Web URL** — fetched page content.
- **YouTube URL** — the video's transcript.

You can also exclude notes and folders. Large source sets take longer to prepare. If you send a message while context is still loading, Agent Mode queues it and runs it when the context is ready.

PDFs, EPUBs, and other supported binary files included through a project source are converted by Copilot's hosted document service before the agent runs. This project-context path requires a Copilot license and does not use the **Document Processor** setting, so choosing Miyo does not keep those project files local. For local-only handling, do not include those files in project context; ask the active agent to read them with its own local tools or skills instead.

### Switch or manage projects

Use the project picker in Agent Mode to switch projects. The active history and prepared context change with the project.

From the picker you can edit or delete a project and sort the list by recent use or alphabetically. Deleting a project entry does not delete conversation notes that were already saved in your vault.

Set the order under **Settings → Copilot → Basic → Project list sort strategy**.

---

## Projects in Quick Chat

The older Quick Chat project experience is still available:

1. Open **Copilot Chat Window**.
2. Choose **Projects (alpha)** from the mode selector.
3. Select **New Project**.

Quick Chat projects keep their legacy model, temperature, max-token, and Project System Prompt settings. Those controls do not configure the agent used by Agent Mode.

---

## Related

- [Agent Mode and Tools](agent-mode-and-tools.md) — Set up an agent and choose permissions
- [Instructions and System Prompts](system-prompts.md) — Vault and project instructions
- [Context and Mentions](context-and-mentions.md) — Add context outside a project
- [Quick Chat Interface](chat-interface.md) — Use the legacy Projects chat mode
