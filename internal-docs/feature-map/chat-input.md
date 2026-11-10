# Chat input

The box at the bottom of Agent Chat where the user writes and sends a message: model, effort, and mode pickers, mentions, note context, images, send, and stop.

## Sub-features

- input-send: type a message and press Enter or `Send`. While the agent works, typing a draft turns `Stop generating` into `Send`, which [queues the message](queued-messages.md).
- input-stop: `Stop generating` or Escape stops the agent's reply.
- input-mentions: `@` lists Notes, Web tabs, and Folders; `Add context` (**+**) also offers Files. A mentioned note shows as a pill in the text and a badge above it. With multi-agent access, Agents asks other agents the same message.
- input-current-note: the open note or web tab shows as a `Current` badge that the user can remove.
- input-selection: text selected in a note shows as a badge with the text and its line, such as `L3`; text selected in a [turn diff](turn-diffs.md) or a web page shows as a `Selection` badge.
- input-images: paste or drop images to attach them; `Remove image` takes one off.
- input-files: drop a note from the file explorer or a Copilot list such as [Relevant Notes](relevant-notes.md), drop a file of any type from the computer, or pick one through `Files`, to add it as context. A file from outside the vault is copied to the attachment folder first, or to the project's `sources/` folder inside a [project](projects.md); one notice per drop names the copies and their folder.
- input-commands: `/` lists `compact` ("Summarize this chat to free up context"), the agent's skills, and custom commands.
- input-model-effort: `Model · effort` lists models grouped by agent, with an Effort slider; the choice applies when the picker closes.
- input-mode: `Mode` picks `Safe`, `Plan`, or `Auto`; Shift+Tab cycles through them.

## How to get to it

- At the bottom of Agent Chat, on the [start screen](agent-home.md) and in every chat. Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command.
- The `Add selection to chat context` and `Add web selection to chat context` commands add the current selection.

## Driving it

- Send: type a message and choose `Send`. The message shows in the conversation and the [agent's reply](agent-replies.md) streams below it.
- Stop: send a task that keeps the agent busy, then choose `Stop generating`. The reply stops and `Worked for <time>` shows.
- Escape: send another long task and press Escape in the chat input. The reply stops.
- Draft while working: while the agent works, type text. `Stop generating` becomes `Send`.
- Mentions: type `@`. Notes, Web tabs, and Folders are listed. Type part of a note name and press Enter. The note shows as a pill in the text and as a badge above it.
- Add context: choose `Add context` (**+**). Notes, Web tabs, Folders, and Files are listed.
- Current note: open a note beside Agent Chat. A badge with its name and `Current` shows above the text.
- Selection: select a line in that note. A badge with the selected text and its line (`L3`) shows next to the `Current` badge.
- Images: paste an image into the chat input. A preview shows above the text; `Remove image` takes it off.
- Files: drop a `.csv` file from Finder onto the chat input. A copy appears in the attachment folder, a notice reads `Copied <file> into <folder>/`, and its badge shows above the text. Drag a note from the file explorer onto the chat input: its badge shows and nothing is copied.
- Commands: type `/`. `compact` is listed first with "Summarize this chat to free up context", followed by skills.
- Model and effort: choose `Model · effort`. Models are grouped under each agent (OPENCODE, CLAUDE, CODEX), the current one checked, with an Effort slider below. Pick another model of the same agent and close the picker; the button shows the new model.
- Mode: choose `Mode`. `Safe`, `Plan`, and `Auto` are listed with a line each. Press Shift+Tab in the chat input; the button moves from `Auto` to `Safe`, then `Plan`, then back to `Auto`.

## Gotchas

- Picking another agent's model in `Model · effort` replaces the chat in the tab with a new chat on that agent, and that agent becomes the default for new chats.
- While the agent works, Escape in the chat input stops the reply even when a draft is typed.
- A file dragged from Finder that is already in the vault is attached where it is, not copied. One drop can carry notes and outside files together; each is attached. Folders can't be attached: dropping one shows a notice.
