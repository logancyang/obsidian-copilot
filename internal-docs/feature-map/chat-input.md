# Chat input

The box at the bottom of Agent Chat where the user writes and sends a message: model, effort, and mode pickers, mentions, note context, images, send, and stop.

## Sub-features

- input-send: type a message and press Enter or `Send`. While the agent works, typing a draft turns `Stop generating` into `Send`, which [queues the message](queued-messages.md).
- input-stop: `Stop generating` or Escape stops the agent's reply.
- input-mentions: `@` lists Notes, Web tabs, and Folders; `Add context` (**+**) also offers Files. A mentioned note shows as a pill in the text only and is still sent as context; badges show only what was attached, in the chat input and on the sent message, and removing a badge leaves the text unchanged. Mentioning the active note does not switch its `Current` badge on. A sent message draws a mentioned folder as a `{Parent/Folder}` pill in its text. `@` and `[[` suggest no files or folders from the Copilot folder except the projects folder and what the user keeps in each project, and never a project's `project.md`.
- input-agent-mentions: with a license that includes custom agents, `@` lists the vault's custom agents first, each with its face, name and title, above Notes and the other context; typing filters them by name. An agent's own chat leaves that agent out; a Copilot chat lists every agent. A picked agent shows as a pill with its face, and the sent message draws it the same way. An agent's name typed after `@` counts as a mention too; a draft restored after switching chats keeps the mention as `@Name` text. The chat's agent then asks that agent, as [agent mentions](agent-mentions.md) describe.
- input-locked-agents: without custom agents in the license, the `@` list ends with `Ask an agent · Supporter preview` below a divider, with a lock. Choosing it checks the license, then opens the "Custom Agent is a preview for Supporters" dialog and puts nothing in the message; its `See plans` opens the pricing page. If the license now includes custom agents, the row goes away instead. In a vault with agents, `@` lists each agent first instead of that row, greyed with a lock, and typing filters them by name; choosing one puts nothing in the message and opens the same dialog as the locked `New` on the [start screen](agent-home.md): "Your agents are still here" with `Renew`, or, on a device with no license key, "This vault has <n> custom agents" with `Enter license key` first.
- input-setup-locked-agent: in the `@` list, an agent whose model can't run on this device is greyed with a lock. Choosing it closes the list, puts nothing in the message, and opens its [profile](agent-profile.md) with the reason.
- input-setup-locked-agent-chat: a chat with an agent whose model can't run on this device opens read-only: in place of the chat input, "You can read this chat, but <name> can't reply. <reason>" with `New Copilot chat` and `Open <name>'s profile`. A chat whose coding agent isn't set up on this device can't be reopened.
- input-locked-agent-chat: when the license no longer includes custom agents, or on a device with no license key, an agent chat from before opens read-only: in place of the chat input, "Your Supporter plan ended. You can read this chat, but <name> can't reply." with `New Copilot chat` (a new Copilot chat in the tab, without this conversation) and `Renew` (opens the pricing page); without an active paid plan on the device it reads "You can read this chat, but <name> can't reply until you enter a Supporter license key on this device." with `Enter license key`. Its remembered lines and its `@` cards show as before, and a card still opens its conversation read-only; nothing in it acts. A reply already running when the license lapses finishes first, and an `@`-mentioned agent asked before then still brings its reply back.
- input-current-note: the open note or web tab shows as a `Current` badge that the user can remove.
- input-selection: text selected in a note shows as a badge with the text and its line, such as `L3`; text selected in a [turn diff](turn-diffs.md) or a web page shows as a `Selection` badge.
- input-images: paste or drop images to attach them; `Remove image` takes one off.
- input-files: drop a note from the file explorer or a Copilot list such as [Relevant Notes](relevant-notes.md), drop a file of any type from the computer, or pick one through `Files`, to add it as context. A file from outside the vault is copied to the attachment folder first, or to the project's `sources/` folder inside a [project](projects.md); one notice per drop names the copies and their folder. A folder dropped from the file explorer, or picked through `Add context` > Folders, shows as a badge and is listed to the agent by its vault path, like a note.
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
- Mentions: type `@`. Notes, Web tabs, and Folders are listed. Type part of a note name and press Enter. The note shows as a pill in the text and no badge is added. Attach the same note through `Add context`, then remove its badge: the pill stays in the text.
- Agent mentions: with a license that includes custom agents and agents Coco, Maya and Leo, in Coco's chat type `@`. Maya and Leo are listed first, with their faces and titles; Coco is not. Type `le`: only Leo stays above the matching notes. Press Enter: a pill with Leo's face shows in the text, and after sending, the message shows the same pill. In a Copilot chat, `@` lists Coco too.
- Locked agents: after custom agents have launched, with a license without custom agents, or none, type `@` in a chat. `Ask an agent · Supporter preview` is the last row, with a lock. Choose it: the "Custom Agent is a preview for Supporters" dialog opens and the message keeps only what was typed. `See plans` opens the pricing page. Enter a license with custom agents: the row is gone from the `@` list.
- Locked agents in a vault with agents: after custom agents have launched, with a license that no longer includes custom agents, type `@`: each agent is listed first, greyed with a lock, and `Ask an agent` is gone. Choose Maya. "Your agents are still here" opens with the vault's faces and `Renew`; with no license key on the device, "This vault has <n> custom agents" opens with `Enter license key` first.
- Setup-locked agent: turn off an agent's model in Copilot's model settings. Type `@` in another chat: that agent is greyed with a lock; choose it and its profile opens with the message keeping only what was typed. Open that agent's chat from `Recent chats`: the read-only note names the model; `Open <name>'s profile` opens the profile, and picking another model there brings the chat input back.
- Locked agent chat: after custom agents have launched, start a chat with an agent while the license includes custom agents, then let the license lapse and open that chat from `Recent chats`. The messages show, with their remembered lines and relayed replies, the chat input is replaced by the read-only note, and `New Copilot chat` opens a new Copilot chat in the tab. Enter a license with custom agents: the chat input comes back without a reload.
- Copilot files: with a saved chat, a custom command, and a project holding a note, type `@` then part of each name, and `[[` then the same. The project's note is listed; the saved chat, the custom command, and the project's `project.md` are not.
- Add context: choose `Add context` (**+**). Notes, Web tabs, Folders, and Files are listed.
- Current note: open a note beside Agent Chat. A badge with its name and `Current` shows above the text.
- Selection: select a line in that note. A badge with the selected text and its line (`L3`) shows next to the `Current` badge.
- Images: paste an image into the chat input. A preview shows above the text; `Remove image` takes it off.
- Files: drop a `.csv` file from Finder onto the chat input. A copy appears in the attachment folder, a notice reads `Copied <file> into <folder>/`, and its badge shows above the text. Drag a note from the file explorer onto the chat input: its badge shows and nothing is copied. Drag a nested folder from the file explorer onto the chat input: its badge shows above the text, the message text is unchanged, and the sent message shows the folder badge.
- Commands: type `/`. `compact` is listed first with "Summarize this chat to free up context", followed by skills.
- Model and effort: choose `Model · effort`. Models are grouped under each agent (OPENCODE, CLAUDE, CODEX), the current one checked, with an Effort slider below. Pick another model of the same agent and close the picker; the button shows the new model.
- Mode: choose `Mode`. `Safe`, `Plan`, and `Auto` are listed with a line each. Press Shift+Tab in the chat input; the button moves from `Auto` to `Safe`, then `Plan`, then back to `Auto`.

## Gotchas

- Picking another agent's model in `Model · effort` replaces the chat in the tab with a new chat on that agent, and that agent becomes the default for new chats. Other agents' models are listed only until a message is sent. A chat opened with `Continue from here in a new chat` lists them too until its first message; switching it keeps its messages, title and single chat note, and reopening it from Recent chats before that message opens it on the agent and model picked.
- A chat reopened from Recent chats or [Copilot Navigator](copilot-navigator.md), after `Shut down` or an Obsidian restart, comes back on the model and effort of its last reply, not the agent's `Default model`.
- While the agent works, Escape in the chat input stops the reply even when a draft is typed.
- Only suggestions skip Copilot's own files: a note link typed in full, a dropped file, and the `Active Note` row still attach one.
- A file dragged from Finder that is already in the vault is attached where it is, not copied. One drop can carry notes and outside files together; each is attached. A folder from outside the vault can't be added: dropping one shows a notice.
- `Ask an agent · Supporter preview` shows only in Agent Chat, never in Quick Chat. It shows only after launch, for every license without custom agents. It checks the license with Brevilabs even with no license key.
