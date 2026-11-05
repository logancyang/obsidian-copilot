# Chat controls

The bar above the [chat input](chat-input.md) in a conversation, with `New chat` and `Chat history`.

## Sub-features

- controls-new-chat: `New chat` replaces the current tab's chat with a new one. The replaced chat leaves the tab strip; it keeps running if the user sent a message in it, reachable from Recent chats, and otherwise stops.
- controls-history: `Chat history` lists past chats as [chat rows](chat-rows.md), with a search box.
- controls-usage: `Usage` shows how full the context window is, and the agent plan's usage when it reports one.
- controls-tasks: `N tasks running` lists the agent's background tasks; choose one to open it, or `Stop task`.
- controls-save-note: `Save chat as note`, shown only when chats are not saved automatically.
- controls-more: `More actions` → `Open chat note`, `Copy chat link`, and `Add to bookmarks`; the last two wait until the chat has a message ("Send a message to the chat first.").
- controls-report: `More actions` → `Report an issue` opens [Report an issue](report-issue.md) with this chat's details.

Only the sub-features are mapped so far, and they may not cover everything this feature does. To map the rest, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).
