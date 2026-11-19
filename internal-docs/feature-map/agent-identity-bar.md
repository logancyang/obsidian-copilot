# Agent identity bar

A bar at the top of a chat with a custom agent: the agent's face, its name, and its title, so the user always knows which agent they are talking to.

## Sub-features

- identity-bar: a chat with a custom agent shows the agent's face, name, and title under the [chat tabs](chat-tabs.md) and above the messages, with a divider under it. It stays in place while the conversation scrolls. It shows no model and no color. An arrow at its right end shows that the whole bar opens the [agent profile](agent-profile.md); hovering it brightens the bar.
- identity-bar-long: a long name and a long title are each cut to one line.
- identity-bar-no-title: an agent with no title shows the first sentence of its instructions in the title's place.
- identity-bar-copilot: a Copilot chat has no bar and looks as it does without custom agents.
- identity-bar-gone: a chat whose agent's folder is deleted shows no bar.
- identity-bar-live: a renamed agent or a new face file shows in the bar without reopening the chat.
- identity-bar-navigator: the bar stays while the [Copilot Navigator](copilot-navigator.md) hides the tabs.

## How to get to it

Choose an agent's face on the [start screen](agent-home.md) and send a message, or open an agent's chat from Recent chats or the Navigator. It needs a license that includes custom agents (a team license until launch).

## Driving it

- Bar: choose an agent on the start screen and send a message. The conversation shows the agent's face, name, and title above the messages; scrolling the conversation leaves the bar in place. Hover the bar: it brightens and says "Open <name>'s profile". Click it: the [agent profile](agent-profile.md) covers the chat.
- Long name: start a chat with an agent whose name and title are longer than the sidebar is wide. Each is cut to one line with an ellipsis.
- No title: start a chat with an agent whose title is empty. The bar shows the first sentence of its instructions.
- Copilot: with Copilot selected, send a message. No bar shows.
- Gone: delete an open agent chat's agent folder. The bar goes away and the chat stays open with no error; its tab and row show the agent logo.
- Live: change the agent's name in its instructions file, or replace its face file. The bar shows the new name and face.
- Navigator: open the [Copilot Navigator](copilot-navigator.md) while an agent chat shows. The tabs hide and the bar stays.

## Gotchas

- The bar shows once the chat has a message. Before that, the start screen's row of faces shows who the chat is with.
- Without a license that includes custom agents, chats look as they do without custom agents: no bar, no profile, and the [chat tabs](chat-tabs.md) and [chat rows](chat-rows.md) show the agent logo.
