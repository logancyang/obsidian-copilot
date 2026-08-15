# Agent Projects

Projects give Copilot Agent a focused workspace for ongoing work. Each project keeps its own instructions, reusable context, and chats, so work for a client, codebase, or research topic stays together.

Projects work with opencode, Claude, and Codex. They use whichever agent, model, and operating mode you currently selected; a project does not pin a separate model or temperature.

## Create a project

1. Click the **Agent** ribbon icon, or run **Open Copilot Agent Chat Window**.
2. On Agent Home, open **Projects** and select **New project**.
3. Enter a project name and select **Create**.

Copilot opens the new project immediately. Creation only asks for a name; use **Edit project** later to add a description, instructions, or context.

Each project gets a folder under `<Copilot folder>/projects/` (by default, `copilot/projects/`). `project.md` stores the project settings and context list. `AGENTS.md` stores the instructions you write for the agent.

## Add project instructions

Open the project info button beside the project name and select **AGENTS.md**. You can also choose **Edit project** from the project list and edit **Project instructions**. Both edit the same file.

Vault-wide instructions still apply. Project instructions are more specific and win when the two conflict. Copilot makes the same project `AGENTS.md` available to opencode, Claude, and Codex, so you do not need separate instructions for each agent.

Useful project instructions include the goal, important folders, preferred output format, and any files the agent should not change. Keep stable rules here; put one-off requests in chat.

## Add reusable context

For a new project, **Context** appears below the composer. Once the project has chats, it becomes a **Context** tab beside **Recent Chats**.

You can:

- drag a vault file or folder into **Context**;
- select **URL** to add a web page or YouTube video; or
- select **Manage** or **Manage Context** to add **Links**, **Tags**, **Properties**, **Folders**, or **Files**, and to manage **Ignore Files**.

Tags match tags stored in note properties. Properties can target notes by a frontmatter property, such as `Topics: Physics`.

When a project chat starts, Copilot prepares its saved context. If preparation is still running when you send a message, the message waits and starts automatically when the context is ready. Existing project chats keep the instructions and context captured when they started. Start a new chat to use your changes.

Markdown, text, and source-code files can be read directly by the active agent. Web pages, YouTube transcripts, and binary files such as PDFs, Office documents, EPUBs, spreadsheets, and common images are converted through Copilot's hosted service and require an active Copilot license.

> [!warning] Private files
> Hosted project conversion bypasses the **Document Processor** setting. For a project that must make no Brevilabs requests, keep binary files, web URLs, and YouTube URLs out of saved project context. Use Markdown context plus local tools or Miyo, and a local model if prompts must also remain on-device.

**Ignore Files** controls prepared context, not the agent's file permissions. An agent may still find an ignored file through its native tools if that file is inside a folder the agent can access.

## Switch and manage projects

Return to Agent Home and open **Projects** to switch projects. Inside a project, **Recent Chats** and **Chat History** show only that project's conversations. Return to Agent Home for the global **Recent Chats** list across projects.

Hover over a project in the list to **Reveal in vault**, **Edit project**, or **Delete** it. Use **Leave project** beside the project name to return to Agent Home. Deleting a project removes its Copilot project configuration; your vault notes and saved conversation notes stay in the vault.

## Related

- [Agents in Copilot V4](agent-mode-and-tools.md) — Set up opencode, Claude, or Codex
- [Instructions and System Prompts](system-prompts.md) — Configure vault-wide instructions
- [Context and Mentions](context-and-mentions.md) — Add one-time context to a chat
