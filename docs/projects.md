# Projects

Projects are focused workspaces inside Agent Chat. Each Project keeps its own instructions, reusable context, and chat history, so ongoing work for a client, codebase, course, or research topic stays together.

A Project works with OpenCode, Claude, or Codex. It uses the agent, model, effort, and permission setting selected for the current chat. It does not lock you to a separate model.

On the Agent Chat home screen, open **Projects** to browse your most recently used Projects. Scroll the list to see more, or use **Search projects** to find a Project by name or description. Search includes every Project, even those you have not scrolled to yet.

## Create a Project

1. Open **Agent Chat** from the ribbon or command palette.
2. From the Agent Chat home screen, open **Projects** and select **New project**.
3. Enter a name and select **Create**.

Copilot opens the new Project immediately. Creation asks only for a name. Use **Edit project** to add a description and instructions, and the **Files** tab to add saved context.

Each Project has a folder under `<Copilot folder>/projects/`. The default root is `copilot/projects/`. Its `project.md` file stores Project details and the context list. Its `AGENTS.md` file contains the instructions you own and edit.

## Add Project instructions

In a Project chat, open the Project info menu beside the name and select **AGENTS.md** under **Project folder**. You can also select **Project settings** beside the name, or **Edit project** from the Projects list, and edit **Project instructions**. Each opens the same Project file.

Vault-wide instructions still apply. Project instructions are more specific, so they take precedence when the two files conflict. The same Project `AGENTS.md` works with OpenCode, Claude, and Codex.

Useful Project instructions include:

- the goal and intended audience;
- important source and output folders;
- the expected deliverable format;
- naming, style, or citation rules; and
- actions that should always require confirmation.

Keep stable rules in `AGENTS.md` and put one-off requests in chat. Start a new Project chat after changing the file so every backend reads the latest instructions. See [Instructions for Agent Chat and Quick Chat](system-prompts.md).

## Browse Project files

A Project opens on its **Files** tab, beside **Recent chats**. When the Project has no chats, or the sidebar is open, **Files** appears alone below the message box. It shows the Project folder as a tree, folders first. **Linked** lists the notes, folders, tags, properties, and web and YouTube links linked to the Project.

- Select a file to open it, or a folder to expand it.
- Drag a note, PDF, or image into the message box to add it to your message.
- Right-click a file or folder for its file menu.

### Link notes, folders, tags, properties, and web pages

- Drag a note or folder from the file explorer onto the **Files** tab to link it. Folders at any depth link by their full location.
- Select **Link context** beside **Linked**, then **Files**, **Folders**, **Tags**, **Properties**, or **Link**. Pick the note, folder, tag, or property to link, or paste a web or YouTube link. For a property, pick a value, or **Any value** to link every note that has the property.
- A linked tag shows how many notes have it. Select it to list those notes. A note counts when the tag is in its properties or its text, and a tag also covers the tags nested under it, so `#project` includes `#project/alpha`. The list updates as you tag and untag notes.
- A linked property, such as `status: active`, works the same way: it shows how many notes have that value and lists them when selected.
- Select a linked web page or YouTube video to open it in your browser.
- Select **Unlink** on a linked item to remove it from the Project. The note, folder, tag, or property stays in your vault.
- Drag a file from your computer onto the **Files** tab to copy it into the Project's `sources/` folder. If a file with that name is already there, the copy gets a number added to its name.

Linking never moves a vault file. Dropping on the message box adds the item to that message only.

### See what a chat changed

In a Project chat, open the Project info menu beside the name. **Changed in this chat** lists each file the chat created, edited, or deleted, newest first, with **new**, **edited**, or **deleted** and the number of lines added and removed. A file changed in several turns appears once, counted from before the chat first changed it. Select a file to open it.

Below it are the same **Project folder** and **Linked** sections as the **Files** tab. To link context from here, select **Link context** beside **Linked**.

**Changed in this chat** covers the current session only. After you reload Obsidian or reopen the chat, it stays empty until the chat changes another file.

## Add reusable context

Link notes, folders, tags, properties, and web pages from the **Files** tab (see [Link notes, folders, tags, properties, and web pages](#link-notes-folders-tags-properties-and-web-pages)). A property targets notes by a frontmatter field, such as `Topics: Physics`.

When a new Project chat starts, Copilot gives the agent a list of the saved context: folders, notes, files, and the notes that have each linked tag or property by their location, and web pages and YouTube videos as links. Nothing is downloaded or converted in advance. The agent reads each source when a question needs it.

An existing Project chat keeps the instructions and context captured when that chat started. Start a new chat after changing either one when you need the updated version.

### File and link support

Markdown, text, and source files can be read directly by the active agent. Binary files such as PDFs, Office documents, EPUBs, spreadsheets, and common images are not converted. Copilot gives the agent the absolute path of each original file, and the agent opens it with its own tools. With **Miyo document processing** on, agents use Copilot's Miyo parse tool for PDF and EPUB files. How well an agent reads a given format depends on that agent.

The agent opens a saved web page with its own web tool or Copilot's web fetch Skill, and reads a YouTube video through Copilot's YouTube transcript Skill, which requires an eligible Copilot plan. An agent without its own web tool or the matching Skill cannot read a saved link.

> **Private Projects:** When a chat starts, Copilot does not upload a Project's files or fetch its links. The list of file paths and links goes to the selected model as part of the first message. A link's address goes to Brevilabs only when the agent fetches it through a Copilot-hosted Skill. If a Project must not send task content to Brevilabs, use Markdown and document files with local tools or local [Miyo](vault-search-and-indexing.md), use a local model if prompts must also stay on the device, and disable cloud-backed Copilot Skills for every agent you use.

To keep the agent away from a folder, say so in the Project's instructions (`AGENTS.md`).

## Work with Project chats

Inside a Project:

- **Recent chats** and **Chat history** show that Project's conversations.
- **New chat** starts a clean conversation with the latest Project instructions and context.
- **Leave project** returns to the Agent Chat home screen.
- **Project settings** beside the name edits the Project, and **Reveal project folder in vault** shows its folder in the file explorer.

From the Projects list, hover over a Project to **Reveal in vault**, **Edit project**, **Archive**, or **Delete** it. The global **Recent chats** list on the Agent Chat home screen includes conversations from across Projects.

Archiving a Project puts it away without deleting it. The Project and all of its chats, pinned ones included, disappear from the Projects list, **Recent chats** and **Chat history**. A chat that is still running keeps running. Select **View archived** below **Recent chats** to unarchive the Project, which brings back the Project and every chat in it, or to open it.

Deleting a Project removes its Copilot Project configuration. It does not delete your ordinary vault notes or conversation notes already saved in the vault.

## When to use a Project

Use a Project when a task has a stable scope or will continue across several chats. Use a one-turn [context attachment](context-and-mentions.md) when the material matters only for the next message. Use the vault-root `AGENTS.md` when an instruction should apply everywhere.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [`AGENTS.md` Examples](agents-md-examples.md)
- [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md)
