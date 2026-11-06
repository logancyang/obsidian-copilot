# Projects

A project groups chats with its own instructions and context. Agent Chat shows the project's header while the user is inside it.

## Sub-features

- project-create: `New project` asks for a `Project name`; `Create` makes the project and enters it.
- project-list: the `Projects` tab on the [start screen](agent-home.md) lists projects, filtered by `Search projects...`; choose one to enter it.
- project-row-actions: a project row offers `Reveal in vault`, `Edit project`, `Archive`, and `Delete`. Archiving moves the project under `View archived`; deleting asks first and keeps the notes in the vault.
- project-enter: inside a project, the start screen reads `Chat in <project>` and lists only its chats; it has its own [chat tabs](chat-tabs.md).
- project-header: the header shows the project's name, `Leave project`, and `Project info for <project>`.
- project-info: `Project info for <project>` shows `Progress` on the agent's plan, `Edit project <project>`, and `Reveal project folder in vault`.
- project-edit: `Edit project` opens the project's name, description, `Project instructions`, and context sources.
- project-files: `Project files` in the project info lists `AGENTS.md` and the files in the project folder to open, and `Outputs`.
- project-context: the project's `Context` takes files and folders dragged in, links from `+ URL`, and more sources from `Manage`.

## How to get to it

- The `Projects` tab on the [start screen](agent-home.md): `New project`, or choose a project.
- `New project`, a project folder, or `New chat in <project>` in the [Copilot Navigator](copilot-navigator.md).
- Opening a project's chat from `Chat history` in the [chat controls](chat-controls.md) or from Recent chats.

## Driving it

- Create: in `Projects`, choose `New project`, type a name, and choose `Create`. Agent Chat enters the new project: the header shows its name and the greeting reads `Chat in <project>`.
- List: type part of a project name into `Search projects...`. Only matching projects remain.
- Enter: choose a project in `Projects`. The header shows its name, and the start screen lists only its chats.
- Leave: choose `Leave project`. The global start screen returns with its `Recent chats`, `Relevant Notes`, and `Projects` shelf.
- Info: choose `Project info for <project>`. A panel shows the project's name with `Edit project <project>` and `Reveal project folder in vault`, then `Progress` when the agent has a plan, then `Project files`.
- Files: in the project info, choose `AGENTS.md`. The project's `AGENTS.md` opens as a note.
- Context: in a project's `Context`, choose `+ URL`, enter a web address, and choose `Add 1`. The link shows as a chip, and the `Context` tab's count goes up. `Manage` opens `File context`, listing the link under `Web`.
- Edit: hover a project in `Projects` and choose `Edit project`. The `Edit project` dialog shows `Project name`, `Description`, `Project instructions`, and `Context sources`.
- Reveal: choose `Reveal in vault`. The file explorer opens with the project's folder selected.
- Archive: choose `Archive`. The project leaves `Projects` and the count drops; it is listed under `View archived` in Recent chats.
- Delete: choose `Delete`, then `Delete` in the confirmation. The project leaves `Projects`; its folder and `AGENTS.md` stay in the vault.

## Gotchas

- `Project instructions` in `Edit project` and the project's `AGENTS.md` are the same text; editing either changes both.
- A new project shows its `Context` under the chat input instead of a shelf. The shelf with `Recent chats` and `Context` appears once the project has a chat.
- While the [Copilot Navigator](copilot-navigator.md) is open, the project header has no `Leave project`; leave through the Navigator.
