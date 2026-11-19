# Agent profile

A custom agent's page in the sidebar: its face, name, and title, how many chats it has had, the two files that make it, its model, a way to start a new chat with it, and Delete.

## Sub-features

- profile-page: the profile covers the current chat inside its tab, under the [chat tabs](chat-tabs.md), with `Back to chat` at the top. `Back to chat`, Esc, or clicking the chat's tab returns to the same chat, or the same new chat page, with its draft and scroll as they were. Switching to another tab leaves the profile.
- profile-head: the agent's face, name, and title, with how many chats it has had and since when, such as "23 chats · since Oct 3". An agent with no title shows the first sentence of its instructions.
- profile-edit-icons: hovering the head of the profile shows a pencil on the face, name, and title; moving the keyboard onto one of them shows its pencil.
- profile-rename: choosing the name turns it into a box: Enter or a click elsewhere saves, Esc cancels, and "Enter to save · Esc to cancel" shows under it. A name already on the team, in any case, shows "Maya is already on your team. Pick another name." and is not saved. The new name shows on the start screen, the tab, and the identity bar, also for chats from before; the agent's folder keeps its name.
- profile-title: choosing the title edits it the same way. An empty title shows the first sentence of the instructions in its place.
- profile-face: choosing the face opens `Pick a face`, the same grid as the [create agent dialog](create-agent-dialog.md), with the agent's own face chosen. Choosing a preset or `Upload image` changes the face at once.
- profile-model: `Model`, "New chats and @-mentions", picks the model and effort the agent's new chats start on. Open chats keep their model.
- profile-instruction: "What <name> handles" opens the agent's instructions file in a new tab of the main editor area, and reads who writes it and when it last changed, such as "Instruction · you write this · edited Nov 2" ("written today" for an instruction not edited since the day it was made). Past 4,000 characters it reads "Instruction · 4,620 characters · longer than <name> follows well" in orange.
- profile-memory: "Rules <name> remembers" opens the agent's memory file in a new tab of the main editor area, and reads how many rules it holds and when it last changed, such as "Memory · Coco adds to this · 9 rules · today 14:31". It follows the file as the agent saves rules.
- profile-memory-empty: an agent that has saved no rule yet reads "Nothing yet. <name> adds a rule when you correct it or ask it to remember something." and has no `Open`.
- profile-new-chat: `New chat with <name>` opens a new chat with the agent in a new tab. From the new chat page, it returns to that page, where the agent is already selected.
- profile-delete: `Delete <name>…` at the bottom asks first in "Delete <name>?": "This deletes <name> and everything below. You can't undo it.", then "What <name> handles" and "Rules <name> remembers" with their file locations and the rule count, "<n> chats with <name>" ("They leave Recent chats and the Navigator."), and the agent's face. A memory file, face, or chats the agent does not have are not listed. A long name shortens on the red button with an ellipsis. `Cancel` has the keyboard; the red button reads `Delete <name>`.
- profile-delete-done: deleting moves the agent's folder to the trash that the "Deleted files" setting names, deletes every chat with the agent (a running one is stopped first) and closes their tabs. The tab the profile covered becomes a new chat on the start screen with Copilot selected, the agent is gone from the row of faces, and a notice reads "Deleted <name> and <n> chats." Only chats recorded with exactly this agent go: other agents' chats, Copilot chats, notes outside the chats folder (an open chat's note moved out of it included), and a chat note whose own `agent` property no longer names this agent stay.
- profile-delete-failed: when one of the agent's chats can't be deleted, the agent stays with that chat and the notice reads "Couldn't delete 1 of <name>'s 4 chats, so <name> was kept."; deleting again finishes the job. When the folder can't go to the trash, the notice names the chats that went: "Deleted 3 chats with <name>, but couldn't delete <name>." When the agent is already gone, or custom agents stop, by the time `Delete <name>` is chosen, nothing is deleted and the notice reads "Couldn't delete <name>."
- profile-locked: when the license no longer includes custom agents, or on a device with no license key that has the agent's files, the profile opens locked from the agent's face. A banner under `Back to chat` reads "Your Supporter plan ended. <name> can't chat until you renew." with `Renew` (opens the pricing page), or, without an active paid plan on the device, "<name> can't chat until you enter a Supporter license key on this device." with `Enter license key` (opens the license field in Copilot settings). The face is greyed with a lock, the name and title are plain text, the greyed `Model` row reads "Locked until you renew" (or "Locked until you enter a Supporter license key") and its picker does not open, and there is no `New chat with <name>`. "What <name> handles", "Rules <name> remembers", and `Delete <name>…` work as usual.
- profile-gone: when the agent's folder is deleted while its profile is open, or the license stops including custom agents, the profile goes back to the chat with no error.

## How to get to it

- The [agent identity bar](agent-identity-bar.md) at the top of an agent's chat.
- `Profile` in the line under the row of faces on the [start screen](agent-home.md), with an agent selected.

It needs a license that includes custom agents (a team license until launch). Without one, the locked profile opens from a greyed face on the start screen.

## Driving it

- Page: type a draft in an agent's chat, scroll up, and click the identity bar. The profile covers the chat. Choose `Back to chat`: the same chat shows, at the same scroll position, with the draft. Open the profile again and press Esc, then once more and click the chat's tab: the chat shows again each time.
- Head: open the profile of an agent with chats. The face, name, title, and "<n> chats · since <date>" show.
- Edit icons: hover the head of the profile. Pencils show on the face, name, and title; move away and they go. Click the face twice, or click the name, type a new one and press Enter, then move away: no pencil shows. Press Tab from `Back to chat`: the face's pencil shows, and Tab again moves it to the name.
- Rename: choose the name, type a new one, and press Enter. The profile, the start screen, the tab, and the identity bar show the new name; the agent's folder name on disk is unchanged. Type another agent's name in lowercase: the red note names that agent and nothing is saved. Press Esc: the old name returns and the profile stays open.
- Title: choose the title, clear it, and press Enter. The first sentence of the instructions shows in its place.
- Face: choose the face and pick a preset. The face changes on the profile, the tab, and the identity bar. Choose it again and `Upload image`: the photo becomes the face, cut to a 256 by 256 square.
- Model: open `Model` and pick another model. Choose `New chat with <name>`: the new chat starts on that model; a chat that was already open keeps its model.
- Instruction: choose "What <name> handles". The agent's instructions file opens in a new tab of the main editor area and the profile stays in the sidebar. Paste more than 4,000 characters into that file: the row's line turns orange and names the length.
- Memory: choose "Rules <name> remembers". The agent's memory file opens. Add a rule to it: the count and the time on the row change.
- Memory empty: open the profile of an agent that has saved nothing. The row says nothing is saved yet and offers no `Open`.
- New chat: choose `New chat with <name>` in the profile opened from an agent's chat. A new tab opens with the agent selected. Open the profile from the start screen and choose it: the start screen shows again with the agent selected.
- Delete: choose `Delete <name>…`. The dialog names both files, the rule count, the number of chats, and the face; press Enter: nothing is deleted and the dialog closes. Choose `Delete <name>…` again and then `Delete <name>`. The start screen shows with Copilot selected and without the agent, the notice names the deleted chats, the agent's folder is in the trash, its chats are gone from Recent chats and the Navigator, and other agents' chats remain.
- Delete while working: send the agent a message and, while it replies, delete it from the profile. The reply stops, its tab closes, and the agent is deleted.
- Locked: after custom agents have launched, in a vault with agents, with a license that no longer includes custom agents, choose an agent's face on the start screen. The locked profile opens with `Renew` in its banner. Hover the face, name, and title: no pencil shows; the model picker does not open. Open both files, then delete the agent: it leaves the row and its folder and chats go to the trash. Remove the license key and open another agent's profile: the banner offers `Enter license key`.
- Gone: open an agent's profile and delete its folder outside Obsidian. The profile goes back to the chat.

## Gotchas

- An edit to the instructions file reaches chats that start after it; open chats keep the instructions they started with.
- The dialog says deleting can't be undone even when "Deleted files" sends files to a trash they can be restored from.
- An agent's identity is its folder: a new agent made later with the same name gets none of the deleted agent's chats, because they are deleted with it. Chats left behind when a folder is deleted outside Obsidian belong to the next agent with that folder name, and its profile counts them.
- The preset faces download from the Brevilabs CDN only when the face picker opens.
- The profile belongs to the tab it was opened in: switching tabs and coming back shows the chat, not the profile.
