# Agent chat sessions

A session is a running agent process for one chat. The chat itself (its note or session-index entry) outlives the session: releasing a session never deletes the chat, and the chat can be reopened from history.

## Model

- **Tab strip: a tab is an open conversation.** It stays open, and its session live, until the user closes it, whether or not it has focus. Switching tabs, clicking **+**, or opening another chat never closes a tab.
- **Closing a tab** decides the session: keep it running in the background if the user sent a message in it this run or its composer holds unsent input; otherwise release it.
- **Navigator: no open state.** Moving away from a chat through a Navigator action releases it under the same keep rule, so browsing leaves no sessions behind.
- **History `Close chat`** always releases, worked-in or not.
- The keep rule lives in the session manager (`closeSessionIfLeft`). When to apply it belongs to each surface. The manager never releases a chat because focus moved, and it does not know which surface is showing.

## Relationships

- An open Navigator hides the tab strip. The chat view underneath is the same view, and its own controls (new chat, Recent chats) follow tab rules, so while the Navigator is open they do not release the chat they leave.
- Tabs are per scope (global or one project). Entering a project from the chat view parks the other scope's tabs; it does not close them.
- Opening a saved chat while the focused tab is an empty new chat replaces that tab; otherwise it adds a tab.
- "Sent a message" means in this app run. A saved chat reopened from history shows old messages but counts as not worked in.

## Pitfalls

- Releasing on focus change makes a tab vanish when the user clicks **+** after opening a saved chat. Users read it as the new chat overwriting the old one (https://github.com/Brevilabs/obsidian-copilot-private/issues/849).
- A new Navigator action that switches chats must release the chat it left, or sessions pile up behind green "session open" dots.
- Two buttons are labeled `Close chat`: the tab's X closes the tab, the history row's power icon releases the session. They do opposite things to the agent process.
- Every open tab holds a live agent process (a few hundred MB for Claude). Users control the count by closing tabs.
- Open tabs are not restored after a plugin reload; a fresh chat starts and earlier chats are reachable only through history.
