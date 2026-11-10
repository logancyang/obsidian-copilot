# Projects

A project groups chats with its own instructions and context. Agent Chat shows the project's header while the user is inside it.

## Sub-features

- project-create: `New project` asks for a `Project name`; `Create` makes the project and enters it.
- project-list: the `Projects` tab on the [start screen](agent-home.md) lists projects, filtered by `Search projects...`; choose one to enter it.
- project-row-actions: a project row offers `Reveal in vault`, `Edit project`, `Archive`, and `Delete`. Archiving moves the project under `View archived`; deleting asks first and keeps the notes in the vault.
- project-enter: inside a project, the start screen reads `Chat in <project>` and opens on `Files`; `Recent chats` lists only its chats. It has its own [chat tabs](chat-tabs.md).
- project-header: the header shows the project name, `Leave project`, `Project settings`, and `Reveal project folder in vault`. Inside a chat it also shows `Project info for <project>`.
- project-info: inside a project chat, `Project info for <project>` shows the project name, `Progress` on the agent's plan, and `Project files`.
- project-edit: `Edit project` opens the project's name, description, `Project instructions`, and context sources.
- project-files: `Project files` in the project info lists `AGENTS.md` and the files in the project folder to open, and `Outputs`.
- project-folder: the home's `Files` view shows `Project folder` and an expandable folder tree; choose a file to open it.
- project-context: `Context sources` in `Project settings` offers `URL` and `Manage context` for editing the project's saved context.

## How to get to it

- The `Projects` tab on the [start screen](agent-home.md): `New project`, or choose a project.
- `New project`, a project folder, or `New chat in <project>` in the [Copilot Navigator](copilot-navigator.md).
- Opening a project's chat from `Chat history` in the [chat controls](chat-controls.md) or from Recent chats.

## Driving it

- Create: in `Projects`, choose `New project`, type a name, and choose `Create`. Agent Chat enters the new project: the header shows its name and the greeting reads `Chat in <project>`.
- List: type part of a project name into `Search projects...`. Only matching projects remain.
- Enter: choose a project in `Projects`. The header shows its name, and the home opens on `Files`. Choose `Recent chats` to see only that project's chats.
- Leave: choose `Leave project`. The global start screen returns with its `Recent chats`, `Relevant Notes`, and `Projects` shelf.
- Settings: choose `Project settings` in the header. The `Edit project` dialog opens.
- Header reveal: choose `Reveal project folder in vault` in the header. The file explorer selects the project folder.
- Info: inside a project chat, choose `Project info for <project>`. A panel shows the project name, then `Progress` when the agent has a plan, then `Project files`.
- Folder tree: on the project home, expand `outputs` and its nested folders, then choose a generated file. It opens in a tab. Create, rename, or delete a file in the folder: the tree updates without restarting.
- Files: in the project info, choose `AGENTS.md`. The project's `AGENTS.md` opens as a note.
- Context: choose `Project settings`, then use `URL` or `Manage context` under `Context sources`. The saved context is available to chats in the project.
- Edit: hover a project in `Projects` and choose `Edit project`. The `Edit project` dialog shows `Project name`, `Description`, `Project instructions`, and `Context sources`.
- Reveal: choose `Reveal in vault`. The file explorer opens with the project's folder selected.
- Archive: choose `Archive`. The project leaves `Projects` and the count drops; it is listed under `View archived` in Recent chats.
- Delete: choose `Delete`, then `Delete` in the confirmation. The project leaves `Projects`; its folder and `AGENTS.md` stay in the vault.

## Gotchas

- `Project instructions` in `Edit project` and the project's `AGENTS.md` are the same text; editing either changes both.
- Files appears alone without a tab bar when the project has no chats or the [Copilot Navigator](copilot-navigator.md) is open. Otherwise the home offers `Files` and `Recent chats`, with Files selected.
- The folder tree shows `AGENTS.md` when present, but hides the project's configuration note and dotfiles. Folders appear before files, sorted by name.
