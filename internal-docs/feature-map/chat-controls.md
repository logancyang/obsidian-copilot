# Chat controls

The bar above the [chat input](chat-input.md) once a chat has a message, with `Usage`, `New chat`, `Chat history`, and `More actions`.

## Sub-features

- controls-new-chat: `New chat` replaces the current tab's chat with a new one. The replaced chat leaves the tab strip; it keeps running if the user sent a message in it, reachable from Recent chats, and otherwise stops.
- controls-history: `Chat history` lists past chats as [chat rows](chat-rows.md), grouped by date, with a `Search...` box; choosing one opens it in the current tab.
- controls-usage: `Usage` shows how full the context window is, and the agent plan's usage when it reports one.
- controls-tasks: `N tasks running` lists the agent's background tasks; choose one to open it, or `Stop task`.
- controls-mentioned-agents: while an [`@`-mentioned agent](agent-mentions.md) works for this chat, the same place reads `Maya is working`, with no clock; two or three agents are named (`Maya and Leo are working`), four or more counted (`4 agents are working`), and the chat's own tasks are added as `· 1 task`. An agent waiting on the user comes first and turns the line orange: `Leo is waiting for you`, or `Leo needs your OK` for a permission request. Hovering lists one row per agent before the tasks, with its face, what it was asked, `Waiting for you` or `Needs your OK` when it waits, and `Stop Leo`; choosing a row opens that agent's conversation, read-only.
- controls-save-note: `Save chat as note`, shown only when chats are not saved automatically.
- controls-more: `More actions` → `Open chat note` (once the chat is saved as a note), `Copy chat link`, `Add to bookmarks` / `Remove from bookmarks`, and `Archive chat` / `Unarchive chat`.
- controls-archived-banner: an archived chat stays open with "This chat is archived." and `Unarchive` above the conversation, wherever it was archived from or opened.
- controls-report: `More actions` → `Report an issue` opens [Report an issue](report-issue.md) with this chat's agent, model, and session filled in.

## How to get to it

Open Agent Chat and send a message, or open a past chat from Recent chats on the [start screen](agent-home.md). The bar sits between the conversation and the chat input. The start screen has no bar.

## Driving it

- New chat: in a chat you sent a message in, choose `New chat`. The tab shows a new start screen; the previous chat is in Recent chats and its row still offers `Shut down`.
- History: choose `Chat history`, type part of a chat title into `Search...`, and choose the match. Its conversation shows in the current tab.
- Usage: hover `Usage`. A tooltip shows `Context window` with used / total tokens and a percentage, plus the plan's usage windows (such as `Weekly · resets in …`) when the agent reports them.
- Tasks: ask the agent to start a shell command in the background. `1 task running` shows at the left of the bar; choose it and the task is listed with `No output yet` or its last output line. Choose the task: its detail view opens, and `Back to chat` returns. Choose `Stop task`: the indicator goes away and the task's card reads `Stopped`.
- Mentioned agents: send `@Maya check every claim in <note>, one by one`. Once the chat's agent answers, the bar reads `Maya is working` with her face. Hover it: Maya's row shows what she was asked. Choose `Stop Maya`: no question is asked, the line goes away, and the chat's agent runs one turn saying how far she got, with a Files changed card for anything she changed.
- Save: with automatic saving off, choose `Save chat as note`. A notice reads "Chat saved as note." With automatic saving on, the button is not shown.
- Copy link: choose `More actions` → `Copy chat link`. A notice reads "Chat link copied." and the clipboard holds a link to the chat.
- Bookmark: choose `More actions` → `Add to bookmarks`. The chat shows in Obsidian's Bookmarks, and the menu now offers `Remove from bookmarks`.
- Archive: choose `More actions` → `Archive chat`. The chat stays open, "This chat is archived." shows above the conversation, and the menu now offers `Unarchive chat`. On the [start screen](agent-home.md) the chat is under View archived, not in Recent chats. Choose `Unarchive` on the banner: it goes away and the chat is back in Recent chats.
- Archived chat: open a chat from View archived. The banner shows; send a message and the banner goes away as the chat unarchives.
- Chat note: choose `More actions` → `Open chat note`. The chat's note opens in a new tab.
- Report: choose `More actions` → `Report an issue`. The Report an issue dialog opens with the chat's agent, model, and session under "What went wrong?".

## Gotchas

- `Copy chat link` and `Add to bookmarks` save the chat as a note first, even when chats are not saved automatically, so `Open chat note` appears after either. `Archive chat` saves it too, so an archived chat can be reopened from View archived.
- Inside a [project](projects.md), `Chat history` lists only that project's chats. Outside one, it lists every chat, and opening a project's chat enters its project.
- The mentioned agents' line counts only agents that still work for this chat in this Obsidian session; after a restart, a chat opened again shows no line for them.
- `New chat` here replaces the chat in place; `New chat` (**+**) in the [chat tabs](chat-tabs.md) adds a tab instead.
