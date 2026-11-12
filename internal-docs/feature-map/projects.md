# Projects

A project groups chats with its own instructions and context. Agent Chat shows the project's header while the user is inside it.

## Sub-features

- project-create: `New project` asks for a `Project name`; `Create` makes the project and enters it.
- project-list: the `Projects` tab on the [start screen](agent-home.md) lists projects, filtered by `Search projects...`; choose one to enter it.
- project-row-actions: a project row offers `Reveal in vault`, `Edit project`, `Archive`, and `Delete`. Archiving moves the project under `View archived`; deleting asks first and keeps the notes in the vault.
- project-enter: inside a project, the start screen reads `Chat in <project>` and opens on the tab last chosen in any project, `Files` at first; `Recent chats` lists only its chats. It has its own [chat tabs](chat-tabs.md).
- project-header: the header shows the project name, `Project settings`, and `Reveal project folder in vault`. Inside a chat it also shows `Project info for <project>`. Its leading control differs between the two layouts below.
- project-header-tabs: with the [chat tabs](chat-tabs.md) showing, the header starts with `Leave project`, a Back button that returns to the [start screen](agent-home.md). The project name is plain text and cannot be chosen.
- project-header-navigator: with the [Copilot Navigator](copilot-navigator.md) open, the header has no `Leave project`. Choosing the project name opens the project home.
- project-info: inside a project chat, `Project info for <project>` shows `Changed in this chat`, followed by `Project folder` and `Linked` to browse. It has no `Link context` and takes no drops.
- project-edit: `Edit project` opens `Project name`, `Description`, and `Project instructions`, with `Cancel` and `Save`. The agent reads the description at the start of each new chat in the project.
- project-files: the project info lists files created, edited, or deleted in the chat, with `new`, `edited`, or `deleted` and lines added and removed.
- project-folder: the home's `Files` view shows `Project folder` and an expandable folder tree; choose a file to open it.
- project-context: the Files view's `Linked` section lists linked notes, folders, tags, properties, and web or YouTube links. `Link context` offers `Files`, `Folders`, `Tags`, `Properties`, and `Link`; `Unlink` removes a link without deleting notes.
- project-files-drop: the project's `Files` tab links vault notes and folders dropped on it, including vault files dragged from Finder, copies files from outside the vault into the project's `sources/` folder, and refuses folders from outside the vault with a notice.

## How to get to it

- The `Projects` tab on the [start screen](agent-home.md): `New project`, or choose a project.
- `New project`, a project folder, or `New chat in <project>` in the [Copilot Navigator](copilot-navigator.md).
- Opening a project's chat from `Chat history` in the [chat controls](chat-controls.md) or from Recent chats.

## Driving it

- Create: in `Projects`, choose `New project`, type a name, and choose `Create`. Agent Chat enters the new project: the header shows its name and the greeting reads `Chat in <project>`.
- List: type part of a project name into `Search projects...`. Only matching projects remain.
- Enter: choose a project in `Projects`. The header shows its name, and the home opens on `Files`. Choose `Recent chats` to see only that project's chats; enter another project and its home opens on `Recent chats` too.
- Leave with tabs: with the chat tabs showing, choose `Leave project` at the left of the header, from the project home or a project chat. The global start screen returns with its `Recent chats`, `Relevant Notes`, and `Projects` shelf. Click the project name: nothing happens, and hovering it shows no link.
- Project home with the Navigator: open the [Copilot Navigator](copilot-navigator.md). `Leave project` disappears from the header. Inside a project chat, choose the project name: the project home returns with `Chat in <project>`.
- Leave with the Navigator: choose `New chat` in the Navigator. The global start screen returns.
- Switch layouts: inside a project, open and close the Navigator. `Leave project` disappears and returns without reopening Agent Chat.
- Header reveal: choose `Reveal project folder in vault` in the header. The file explorer selects the project folder.
- Info: ask the agent to create or edit a project file, then choose `Project info for <project>`. `Changed in this chat` shows the file and its line counts. Choose the row: the file opens and the popover closes.
- Folder tree: on the project home, ask the agent to generate a file: it appears at the top of the project folder. Expand a folder and its nested folders, then choose a file. It opens in a tab. Create, rename, or delete a file in the folder: the tree updates without restarting.
- Files: in project info, expand nested folders under `Project folder` or `Linked` and choose a file to open it. The popover offers no `Link context`. In a narrow chat pane, expand a long tree: the popover fits the pane and scrolls.
- Context: choose `Link context` → `Files` and select a note outside the project folder. It appears under `Linked` with its parent folder. Choose `Folders`, select a nested folder, and expand its row to browse its contents.
- Tag: choose `Link context` → `Tags` and pick a tag. Its row shows the matching-note count. Expand it to open matching notes; tag or untag a note and the list and count update.
- Link: choose `Link context` → `Link`, type or paste a web or YouTube address, and select it. Its row appears under Linked; choosing the row opens the address in the browser.
- Property: choose `Link context` → `Properties`, select a property, then a value. Its row shows the property, value, and matching-note count. Expand it to open matching notes; change a note's property and the list and count update.
- Any value: choose a property and `Any value`. The row reads `<property>: (any)` and lists notes that declare that property.
- Unlink: hover a linked row and choose `Unlink`. Its link disappears; the original note or folder stays in the vault.
- Drop: drag a nested vault folder over `Files`. The area highlights with `Link files to this project`; dropping it adds it under `Linked`. Drop a PDF from Finder: a copy appears in `sources/`, and a notice reads `Copied <file> into sources/`. Drop a PDF from Finder that is already in the vault: it appears under `Linked` and nothing is copied. Select a vault file and a file outside the vault in Finder and drop both: the first is linked and the second is copied. Drop a folder from Finder: a notice refuses it, and nothing is copied or linked. Cancel a drag with Escape: the highlight disappears. Drop a PDF from Finder on the message box: a copy appears in `sources/`, a notice names it, and its badge shows above the text.
- Edit: choose `Project settings` in the header. The `Edit project` dialog opens; edit the fields and choose `Save`. Enter saves; Escape cancels. In a narrow window, open the dialog: Cancel and Save remain visible.
- Description: set `Description` to the project's goal and choose `Save`. In a new chat in the project, ask what the project is for: the agent answers with that goal.
- Reveal: choose `Reveal in vault`. The file explorer opens with the project's folder selected.
- Archive: choose `Archive`. The project leaves `Projects` and the count drops; it is listed under `View archived` in Recent chats.
- Delete: choose `Delete`, then `Delete` in the confirmation. The project leaves `Projects`; its folder and `AGENTS.md` stay in the vault.

## Gotchas

- `Project instructions` in `Edit project` and the project's `AGENTS.md` are the same text; editing either changes both.
- A chat that is already open keeps the description it started with; an edited description reaches new chats only.
- Files appears alone without a tab bar when the project has no chats or the [Copilot Navigator](copilot-navigator.md) is open. Otherwise the home offers `Files` and `Recent chats`.
- The folder tree shows `AGENTS.md` when present, but hides the project's configuration note and dotfiles. Folders appear before files, sorted by name.
- `Link context` stays below the scrolling Project folder and Linked list. A missing linked item stays listed as `Not found` so it can still be unlinked.
- A drop on `Files` is sorted item by item, so one drop can link some items and copy others. Dropping an item already in the project shows `Already in this project`. Copies get numbered names when needed; existing files are not overwritten. A drop on the message box attaches to the message instead, as the [chat input](chat-input.md) describes; a file from outside the vault is still copied into `sources/` first.
- Linked tags include nested tags. Linking a page does not fetch a snapshot or a YouTube transcript.
- Tags and properties are live queries rather than frozen lists of notes. Unlinking a query leaves its matching notes unchanged.
- `Changed in this chat` is empty after reopening a chat following a reload. A file changed in several turns appears once; a file restored to its original content drops out.
- Edit project has no context controls; use `Link context` in Files. Saved file-type patterns and exclusions do not limit project context. Project instructions can ask the agent to avoid a folder; they do not enforce an access restriction.
