# Copilot Navigator

Aliases: Navigator, sessions sidebar, chat sidebar, browse chats, green dot, "session open" dot.

A sidebar listing chats and projects for browsing. It has no open-conversation state: moving away from a chat through a Navigator action releases that chat unless the user sent a message in it this run or left unsent text in its composer. A green dot means the chat's session is live.

## Sub-features

- **Chat rows** with status: green dot (session open), spinner (running), waiting for permission, bold title (unseen result) — `src/agentMode/navigator/ui/SessionsSidebarRow.tsx`.
- **Open a chat, New chat, a project's `New chat in <project>`, New project, and opening from View archived** switch the Agent Chat view and release the chat left behind — `src/agentMode/navigator/ui/SessionsSidebar.tsx` (`releasingLeftChat`).
- **Project folders** expand on click without opening the project — `SessionsSidebarFolderRow.tsx`.
- **Row menu**: Close chat (releases), rename, pin, archive, delete — `src/agentMode/ui/RecentChatMenu.tsx`.
- **Hides the tab strip** while a Navigator leaf is open — `src/agentMode/navigator/hooks/useSessionsSidebarOpen.ts`.
- **Supporter preview**: without access, opening it shows an upsell modal and no leaf — `src/agentMode/navigator/openSessionsSidebar.ts`.

## How to get to it

Command **Open Copilot Navigator**, or the panel button at the left of the tab strip (`Open Copilot Navigator`). Needs a license with Navigator access.

## Where it lives

- Entry points: `src/agentMode/navigator/ui/SessionsSidebarView.tsx`, `SessionsSidebar.tsx`, `SessionsSidebarPanel.tsx`.
- Session rules: `AgentSessionManager.closeSessionIfLeft` (keep-or-release), called by the Navigator's own actions.
- Tests: `src/agentMode/navigator/ui/SessionsSidebar.test.tsx`, `SessionsSidebarPanel.test.tsx`, `SessionsSidebarRow.test.tsx`.

## Driving it

Setup per [README](README.md), plus a license with Navigator access entered in the scratch vault. Read state as in [chat-tabs.md](chat-tabs.md).

1. **Browsing releases.** Open chat A from a Navigator row without sending, then open chat B from another row. Expect A's green dot gone and its session `closed`.
2. **Worked-in chats stay.** Send a message in A, open B from the Navigator. Expect A's green dot to stay.
3. **Strip comes back.** Close the Navigator leaf. Expect the tab strip to return, showing every chat still live.

## Gotchas

- The chat view's own controls (its New chat, Recent chats) follow tab rules, so while the Navigator is open they do not release the chat they leave. A new Navigator action that switches chats must release the chat it left, or sessions pile up behind green dots.
- The upsell modal has no close button; dismiss it with Escape before the next step.
- Settings open in a popout window in the test vault; set `settingsPopoutWindow` to false before entering a license.
