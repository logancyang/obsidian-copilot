# Chat tabs

Aliases: tab strip, session tabs.

A tab is an open conversation: it stays until the user closes it, focused or not, and its agent session stays live while it is open. Closing the tab decides the session: a chat with a message sent this run, or unsent text in its composer, keeps running in the background; any other chat is released.

## Sub-features

- **`+` adds a tab** and focuses it; no other tab closes — `src/agentMode/ui/AgentTabStrip.tsx`.
- **Switch tabs** by click or Enter/Space; clears the tab's attention dot — `AgentTabStrip.tsx`.
- **Close a tab** with its hover X, middle click, or right-click → Close; the neighbor takes focus — `AgentTabStrip.tsx`, `AgentSessionManager.detachSessionFromTab`.
- **Open a saved chat** from Recent chats or the history popover: adds a tab, or replaces the focused tab when that tab is an empty new chat — `AgentSessionManager.loadSessionFromHistory`.
- **Controls-bar New chat** (in a conversation) replaces the current chat in place and closes its session — `src/agentMode/ui/AgentChatControls.tsx`, `AgentSessionManager.replaceSessionInPlace`.
- **History Close chat** (power icon) releases a chat's session and removes its tab — `AgentSessionManager.closeChatSession`.
- **Rename**, **overflow menu**, and **status icon** (spinner, attention dot, error dot) — `AgentTabStrip.tsx`.
- **Per-project tabs**: a project shows only its own chats; leaving it brings the global tabs back — `AgentSessionManager.enterProject`.

## How to get to it

Open the Agent Chat view (ribbon icon or **Open Copilot Agent Chat window**). The strip is at the top of the view; it is hidden while the Copilot Navigator is open ([copilot-navigator.md](copilot-navigator.md)).

## Where it lives

- Entry points: `src/agentMode/ui/AgentTabStrip.tsx`, `src/agentMode/ui/AgentHome.tsx`, `src/agentMode/ui/AgentChatControls.tsx`, `src/agentMode/ui/GlobalRecentChatsSection.tsx`.
- Session rules: `src/agentMode/session/AgentSessionManager.ts` (`closeSessionIfLeft` holds the keep-or-release rule).
- Data: in-memory sessions and composer drafts; chat notes in `copilot/copilot-conversations/` when autosave is on.
- Tests: `src/agentMode/ui/AgentTabStrip.test.ts`, `src/agentMode/session/AgentSessionManager.test.ts`.

## Driving it

Setup per [README](README.md). Read state with `app.plugins.plugins.copilot.agentSessionManager` (`m`): tabs are `m.getSessionsForScope(m.getActiveProjectId())`, the shown chat is `m.getActiveSession()`. Trigger through the UI; selectors are scoped to `.workspace-leaf-content[data-type=copilot-agent-chat-view]`.

1. **`+` after a saved chat** (the #849 path). Click a Recent chats row (`[data-agent-landing] [role=button]`, `GlobalRecentChatsSection.tsx`), then `button[aria-label="New chat"]` (`AgentTabStrip.tsx`). Expect two tabs: the saved chat and the new one.
2. **Close an untouched tab.** From step 1, close the saved chat's tab (`[role=tab]` → `button[aria-label="Close chat"]`, hover first). Expect its tab gone and its session status `closed`; the chat is still in Recent chats.
3. **Close a worked-in tab.** Send one message in a tab, wait for `idle`, close its tab. Expect the session still `idle` and listed in `m.getOpenChatIds()`; reopening it from history brings back the same session.
4. **Controls-bar New chat.** In a conversation, click `button[title="New chat"]` (`AgentChatControls.tsx`). Expect the same tab count, the new chat in the old position, and the old chat in history.

## Gotchas

- Two buttons are labeled `Close chat`: the tab's X closes the tab, the history row's power icon releases the session. Scope selectors to the strip or the row.
- The Recent chats shelf also renders `[role=tab]` (Recent chats, Relevant Notes, Projects); never query tabs across the whole view.
- A narrow chat leaf shows one tab plus an overflow button. Collapse the sidebars before counting tabs.
- Close buttons have zero size until hovered.
- "Sent a message" means this app run: a chat reopened from history with old messages counts as untouched.
- Every open tab holds a live agent process (a few hundred MB for Claude).
- Tabs are not restored after a plugin reload; earlier chats come back only through history.
