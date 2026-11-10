# Projects

A project groups chats with its own instructions and context. Agent Chat shows the project's header while the user is inside it.

## Sub-features

- project-create: `New project` asks for a `Project name`; `Create` makes the project and enters it.
- project-list: the `Projects` tab on the [start screen](agent-home.md) lists projects, filtered by `Search projects...`; choose one to enter it.
- project-row-actions: a project row offers `Reveal in vault`, `Edit project`, `Archive`, and `Delete`. Archiving moves the project under `View archived`; deleting asks first and keeps the notes in the vault.
- project-enter: inside a project, the start screen reads `Chat in <project>` and opens on `Files`; `Recent chats` lists only its chats. It has its own [chat tabs](chat-tabs.md).
- project-header: the header shows the project name, `Leave project`, `Project settings`, and `Reveal project folder in vault`. Inside a chat it also shows `Project info for <project>`.
- project-info: inside a project chat, `Project info for <project>` shows `Changed in this chat`, followed by `Project folder` and `Linked` to browse. It has no `Link context` and takes no drops.
- project-edit: `Edit project` opens `Project name`, `Description`, and `Project instructions`, with `Cancel` and `Save`.
- project-files: the project info lists files created, edited, or deleted in the chat, with `new`, `edited`, or `deleted` and lines added and removed. Its folder tree and Linked section browse the same files as the project home.
- project-folder: the home's `Files` view shows `Project folder` and an expandable folder tree; choose a file to open it.
- project-context: the Files view's `Linked` section lists linked notes, folders, tags, properties, and web or YouTube links. `Link context` offers `Files`, `Folders`, `Tags`, `Properties`, and `Link`; `Unlink` removes a link without deleting notes.

- project-files-drop: the project's `Files` tab links vault notes and folders dropped on it, copies files dropped from outside the vault into the project's `sources/` folder, and refuses folders from outside the vault with a notice.

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
- Info: ask the agent to create or edit a project file, then choose `Project info for <project>`. `Changed in this chat` shows the file and its line counts. Choose the row: the file opens and the popover closes.
- Folder tree: on the project home, expand `outputs` and its nested folders, then choose a generated file. It opens in a tab. Create, rename, or delete a file in the folder: the tree updates without restarting.
- Files: in project info, expand nested folders under `Project folder` or `Linked` and choose a file to open it. The popover offers no `Link context`. In a narrow chat pane, expand a long tree: the popover fits the pane and scrolls.
- Context: choose `Link context` → `Files` and select a note outside the project folder. It appears under `Linked` with its parent folder. Choose `Folders`, select a nested folder, and expand its row to browse its contents.
- Tag: choose `Link context` → `Tags` and pick a tag. Its row shows the matching-note count. Expand it to open matching notes; tag or untag a note and the list and count update.
- Link: choose `Link context` → `Link`, type or paste a web or YouTube address, and select it. Its row appears under Linked; choosing the row opens the address in the browser.
- Property: choose `Link context` → `Properties`, select a property, then a value. Its row shows the property, value, and matching-note count. Expand it to open matching notes; change a note's property and the list and count update.
- Any value: choose a property and `Any value`. The row reads `<property>: (any)` and lists notes that declare that property.
- Unlink: hover a linked row and choose `Unlink`. Its link disappears; the original note or folder stays in the vault.
- Drop: drag a nested vault folder over `Files`. The area highlights with `Link files to this project`; dropping it adds it under `Linked`. Drop a PDF from Finder: a copy appears in `sources/`. Drop a folder from Finder: a notice refuses it, and nothing is copied or linked. Cancel a drag with Escape: the highlight disappears.

- Edit: choose `Project settings` in the header, edit the fields, and choose `Save`. Enter saves; Escape cancels. In a narrow window, open the dialog: Cancel and Save remain visible.
- Reveal: choose `Reveal in vault`. The file explorer opens with the project's folder selected.
- Archive: choose `Archive`. The project leaves `Projects` and the count drops; it is listed under `View archived` in Recent chats.
- Delete: choose `Delete`, then `Delete` in the confirmation. The project leaves `Projects`; its folder and `AGENTS.md` stay in the vault.

## Gotchas

- `Project instructions` in `Edit project` and the project's `AGENTS.md` are the same text; editing either changes both.
- Files appears alone without a tab bar when the project has no chats or the [Copilot Navigator](copilot-navigator.md) is open. Otherwise the home offers `Files` and `Recent chats`, with Files selected.
- The folder tree shows `AGENTS.md` when present, but hides the project's configuration note and dotfiles. Folders appear before files, sorted by name.
- `Link context` stays below the scrolling Project folder and Linked list. A missing linked item stays listed as `Not found` so it can still be unlinked.
- One drop rule covers the `Files` tab and the [chat input](chat-input.md): Copilot works with what is in the vault. A vault note or folder is linked to the project on the `Files` tab and attached to the message on the chat input. A file from outside the vault is copied in, into the project's `sources/` folder or the attachment folder. A folder from outside the vault is never copied or linked by a drop.
- `Recent chats` accepts no drops. Dropping an item already in the project shows `Already in this project`. Copies of external files get numbered names when needed; existing files are not overwritten.
- Linked tags include nested tags. Linking a page does not fetch a snapshot or a YouTube transcript.
- Tags and properties are live queries rather than frozen lists of notes. Unlinking a query leaves its matching notes unchanged.
- `Changed in this chat` is empty after reopening a chat following a reload. A file changed in several turns appears once; a file restored to its original content drops out.
- Only the project home's `Files` tab links context, through `Link context` or a drop. `Project info for <project>` in a chat shows the same files and links read-only.
- Edit project has no context controls; use `Link context` in Files. File-type patterns and exclusions no longer control project context. Project instructions can ask the agent to avoid a folder; they do not enforce an access restriction.
