# Agent profile

A custom agent's page in the sidebar: its face, name, and title, how many chats it has had, the two files that make it, and a way to start a new chat with it.

## Sub-features

- profile-page: the profile covers the current chat inside its tab, under the [chat tabs](chat-tabs.md), with `Back to chat` at the top. `Back to chat`, Esc, or clicking the chat's tab returns to the same chat, or the same new chat page, with its draft and scroll as they were. Switching to another tab leaves the profile.
- profile-head: the agent's face, name, and title, with how many chats it has had and since when, such as "23 chats · since Oct 3". An agent with no title shows the first sentence of its instructions.
- profile-instruction: "What <name> handles" opens the agent's instructions file in a new tab of the main editor area, and reads who writes it and when it last changed, such as "Instruction · you write this · edited Nov 2" ("written today" for an instruction not edited since the day it was made). Past 4,000 characters it reads "Instruction · 4,620 characters · longer than <name> follows well" in orange.
- profile-memory: "Rules <name> remembers" opens the agent's memory file in a new tab of the main editor area, and reads how many rules it holds and when it last changed, such as "Memory · Coco adds to this · 9 rules · today 14:31". It follows the file as the agent saves rules.
- profile-memory-empty: an agent that has saved no rule yet reads "Nothing yet. <name> adds a rule when you correct it or ask it to remember something." and has no `Open`.
- profile-new-chat: `New chat with <name>` opens a new chat with the agent in a new tab. From the new chat page, it returns to that page, where the agent is already selected.
- profile-gone: when the agent's folder is deleted while its profile is open, or the license stops including custom agents, the profile goes back to the chat with no error.

## How to get to it

- The [agent identity bar](agent-identity-bar.md) at the top of an agent's chat.
- `Profile` in the line under the row of faces on the [start screen](agent-home.md), with an agent selected.

It needs a license that includes custom agents (a team license until launch).

## Driving it

- Page: type a draft in an agent's chat, scroll up, and click the identity bar. The profile covers the chat. Choose `Back to chat`: the same chat shows, at the same scroll position, with the draft. Open the profile again and press Esc, then once more and click the chat's tab: the chat shows again each time.
- Head: open the profile of an agent with chats. The face, name, title, and "<n> chats · since <date>" show.
- Instruction: choose "What <name> handles". The agent's instructions file opens in a new tab of the main editor area and the profile stays in the sidebar. Paste more than 4,000 characters into that file: the row's line turns orange and names the length.
- Memory: choose "Rules <name> remembers". The agent's memory file opens. Add a rule to it: the count and the time on the row change.
- Memory empty: open the profile of an agent that has saved nothing. The row says nothing is saved yet and offers no `Open`.
- New chat: choose `New chat with <name>` in the profile opened from an agent's chat. A new tab opens with the agent selected. Open the profile from the start screen and choose it: the start screen shows again with the agent selected.
- Gone: open an agent's profile and delete its folder outside Obsidian. The profile goes back to the chat.

## Gotchas

- An edit to the instructions file reaches chats that start after it; open chats keep the instructions they started with.
- The profile belongs to the tab it was opened in: switching tabs and coming back shows the chat, not the profile.
