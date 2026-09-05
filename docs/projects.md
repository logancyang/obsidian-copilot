# Projects

Projects are focused workspaces inside Agent Chat. Each Project keeps its own instructions, reusable context, and chat history, so ongoing work for a client, codebase, course, or research topic stays together.

A Project works with opencode, Claude, or Codex. It uses the agent, model, effort, and permission setting selected for the current chat. It does not lock you to a separate model.

On the Agent Chat home screen, open **Projects** to browse your most recently used Projects. Scroll the list to see more, or use **Search projects** to find a Project by name or description. Search includes every Project, even those you have not scrolled to yet.

## Create a Project

1. Open **Agent Chat** from the ribbon or command palette.
2. From the Agent Chat home screen, open **Projects** and select **New project**.
3. Enter a name and select **Create**.

Copilot opens the new Project immediately. Creation asks only for a name. Use **Edit project** to add a description, instructions, and saved context.

Each Project has a folder under `<Copilot folder>/projects/`. The default root is `copilot/projects/`. Its `project.md` file stores Project details and the context list. Its `AGENTS.md` file contains the instructions you own and edit.

## Add Project instructions

Open the Project info menu beside the name and select **AGENTS.md**. You can also choose **Edit project** from the Projects list and edit **Project instructions**. Both open the same Project file.

Vault-wide instructions still apply. Project instructions are more specific, so they take precedence when the two files conflict. The same Project `AGENTS.md` works with opencode, Claude, and Codex.

Useful Project instructions include:

- the goal and intended audience;
- important source and output folders;
- the expected deliverable format;
- naming, style, or citation rules; and
- actions that should always require confirmation.

Keep stable rules in `AGENTS.md` and put one-off requests in chat. Start a new Project chat after changing the file so every backend reads the latest instructions. See [Instructions for Agent Chat and Quick Chat](system-prompts.md).

## Add reusable context

For a new Project, **Context** appears below the composer. After the Project has chats, it appears as a **Context** tab beside **Recent Chats**.

You can:

- drag a vault file or folder into **Context**;
- select **URL** to add a web page or YouTube video; or
- select **Manage** or **Manage Context** to add **Links**, **Tags**, **Properties**, **Folders**, and **Files**, or to manage **Ignore Files**.

Tags match tags stored in note properties. Properties can target notes by a frontmatter field, such as `Topics: Physics`.

When a new Project chat starts, Copilot prepares the saved context. If preparation is still running when you send a message, Copilot queues the message and starts it automatically when the context is ready.

An existing Project chat keeps the instructions and context captured when that chat started. Start a new chat after changing either one when you need the updated version.

### File support and hosted conversion

Markdown, text, and source files can be read directly by the active agent. Web pages, YouTube transcripts, and binary files such as PDFs, Office documents, EPUBs, spreadsheets, and common images are converted through Copilot's hosted service and require an eligible Copilot plan.

> **Private Projects:** Hosted Project conversion runs independently of the **Document Processor** setting. If a Project must not send task content to Brevilabs, do not add binary files, web URLs, or YouTube URLs as saved context. Use Markdown context with local tools or local [Miyo](vault-search-and-indexing.md), use a local model if prompts must also stay on the device, and disable cloud-backed Copilot Skills for every agent you use.

**Ignore Files** controls which files are included in prepared context. It is not a file permission setting. An agent can still find an ignored file through its own tools when the file is inside a location that agent can access.

## Work with Project chats

Inside a Project:

- **Recent Chats** and **Chat History** show that Project's conversations.
- **New Chat** starts a clean conversation with the latest Project instructions and context.
- **Leave project** returns to the Agent Chat home screen.

From the Projects list, hover over a Project to **Reveal in vault**, **Edit project**, or **Delete** it. The global **Recent Chats** list on the Agent Chat home screen includes conversations from across Projects.

Deleting a Project removes its Copilot Project configuration. It does not delete your ordinary vault notes or conversation notes already saved in the vault.

## When to use a Project

Use a Project when a task has a stable scope or will continue across several chats. Use a one-turn [context attachment](context-and-mentions.md) when the material matters only for the next message. Use the vault-root `AGENTS.md` when an instruction should apply everywhere.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [`AGENTS.md` Examples](agents-md-examples.md)
- [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md)
