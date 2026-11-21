# Start screen

The start screen of a new chat: a greeting, the [chat input](chat-input.md) for the first message, and the Recent chats / Relevant Notes / Projects shelf.

## Sub-features

- home-greeting: a greeting such as "What can I help with?" above the chat input, picked again for each new chat; inside a project it reads `Chat in <project>`.
- home-agent-row: with a Supporter license, the greeting gives way to the picked teammate and a row of small faces with names under them: Copilot first, then each teammate. Teammates that do not fit the sidebar go into a `+N More` menu; the selected teammate and Copilot always stay in the row. Long names are cut to one line; hovering a face shows the full name and title.
- home-new-agent: `New` (**+**) at the end of the row opens the [New teammate dialog](new-teammate-dialog.md); it never moves into `+N More`. With no teammates yet, the greeting stays and the row holds Copilot and `New`.
- home-locked-new-agent: without a Supporter license, `New` (**+**) shows a small lock and, on hover, "New teammate · Supporter preview". The row holds Copilot and `New` under the greeting. Choosing `New` checks the license, then opens the "Build your AI team with Copilot Teammates" dialog: an opening on what a teammate is for that ends "Copilot Teammates is a preview for Supporters.", three points, a thumbnail of the Copilot Teammates video with a play button (opens it on YouTube; the thumbnail is left out when it cannot load), `Already a Supporter? Enter your license key` (opens the license field in Copilot settings), and `See plans` (opens the pricing page). If the license is now valid, the [New teammate dialog](new-teammate-dialog.md) opens instead. Entering a Supporter license after the dialog only unlocks `New`; nothing opens until it is chosen again.
- home-locked-agents: in a vault with teammates and no valid Supporter license, the row still shows every teammate, greyed with a small lock, and Copilot stays selected. Under the row, "Your teammates need a valid Supporter license to chat." with `Enter license key` (opens the license field in Copilot settings). Hovering a face shows its name and title. Choosing a face checks the license, then opens the teammate's [locked profile](teammate-profile.md); a face never starts a chat. Teammates' chats keep their faces in `Recent chats` and the [chat tabs](chat-tabs.md).
- home-locked-agents-dialog: in a vault with teammates and no valid Supporter license, choosing the locked `New` checks the license, then opens a dialog with the vault's faces and names instead of the Supporter preview. It reads "This vault has <n> teammates": "<names> keep their instructions and memory. You need a valid Supporter license to activate them again.", with `See plans` (opens the pricing page) and `Enter license key` as the main button (opens the license field in Copilot settings). With no teammates, `New` opens the Supporter preview.
- home-picked-agent: above the row, the selected teammate's large face, its name, and its title, with a small gear in the face's corner. Hovering the face grows it slightly and brightens the gear, with the tooltip "Open profile"; choosing it opens the [teammate profile](teammate-profile.md). For Copilot: Copilot's icon, `Copilot`, and "Starts fresh every chat."; the icon opens nothing. A long name is cut to one line and a long title to two.
- home-agent-default: a new chat starts with the teammate of the last chat started, on the start screen and in every project; when that teammate is gone, Copilot.
- home-agent-hint: the chat input's hint names the selected teammate: "Ask Coco anything • @ to add context • / for commands".
- home-agent-chat: the first message starts a chat with the selected teammate, on its model; with Copilot selected, a Copilot chat.
- home-first-message: sending the first message turns the start screen into the conversation, with the [chat controls](chat-controls.md) above the chat input, which keeps the cursor.
- home-shelf: the shelf's `Recent chats`, `Relevant Notes`, and `Projects` tabs, with the project count on `Projects`; the last tab chosen stays selected for every new chat.
- home-recent-chats: `Recent chats` lists past chats as [chat rows](chat-rows.md), pinned chats first, filtered by `Search chats...`. It lists only chats had in Copilot, on every agent; a chat started in OpenCode itself, or in another agent outside Copilot, does not show.
- home-recent-agent-chats: with a Supporter license, each teammate's chat in `Recent chats` shows its teammate's face. With a teammate selected, the list holds only that teammate's chats and the search reads `Search chats with <name>...`; a teammate with no chats yet shows "No chats with <name> yet."
- home-archived: `View archived` under Recent chats lists archived chats and projects, each with `Unarchive`.
- home-relevant-notes: the `Relevant Notes` tab shows [Relevant Notes](relevant-notes.md); it is hidden while the Relevant Notes pane is open.
- home-projects: the `Projects` tab lists [projects](projects.md) with `New project` and `Search projects...`.
- home-project-start: inside a [project](projects.md), the shelf opens on `Files`, with `Recent chats` for that project. Files appears alone when the project has no chats or the [Copilot Navigator](copilot-navigator.md) is open.
- home-needs-setup-agent: a teammate whose model can't run on this device, because its agent isn't set up here or its model is no longer among that agent's enabled models here, shows greyed with the same small lock, named "<name> · Needs setup" to a screen reader, in the row and in `+N More`. Choosing it opens its [profile](teammate-profile.md), which says why and what to fix; it never starts a chat, and a new chat never opens on it, even when it was the last chat's teammate. A new chat already on it goes back to Copilot. It shows ready again, without a reload, as soon as its model changes or its agent is set up. Without a Supporter license, the license lock shows instead.
- home-release-update: when a newer Copilot is out, a `Copilot <version> is ready` card offers `See what’s new` for the release notes, and `Dismiss release update`.

## How to get to it

- Open Copilot Chat from the ribbon icon or the `Open Copilot Chat window` command. A chat with no messages shows the start screen.
- `New chat` (**+**) in the [chat tabs](chat-tabs.md), or `New chat` in the [chat controls](chat-controls.md).
- Enter a project from the `Projects` tab to get that project's start screen.

## Driving it

- Greeting: open a new chat. A greeting shows above the chat input; the next new chat may show a different one.
- Row of faces: with a Supporter license, open a new chat. The row shows Copilot and each teammate's face. Choose a teammate, in the row or from `+N More`: its face in the row is ringed in the accent color, its large face with a gear in its corner, name and title show above the row, and the chat input reads "Ask <name> anything". Hover the large face: it grows slightly and the gear brightens. Choose it, or press Tab to it and then Enter: the [teammate profile](teammate-profile.md) covers the start screen. Choose Copilot: its face takes the ring, and `Copilot` with "Starts fresh every chat." shows above the row, and Copilot's icon has no gear.
- New teammate: with a Supporter license, choose `New` in the row. The [New teammate dialog](new-teammate-dialog.md) opens; after `Create`, the new teammate is in the row, selected. In a vault with no teammates, the greeting shows above Copilot and `New`.
- Locked New: without a Supporter license, open a new chat and in a project too. `New` shows a lock; hovering it shows "New teammate · Supporter preview". Choose `New`: the "Build your AI team with Copilot Teammates" dialog opens. Select the video thumbnail: the video opens on YouTube in the browser and the dialog stays open. `See plans` opens the pricing page and closes the dialog. `Already a Supporter? Enter your license key` opens Copilot settings at the license field; enter a Supporter license: `New` unlocks and no dialog opens. Choose `New`: the New teammate dialog opens.
- Locked teammates: in a vault with teammates, without a Supporter license, open a new chat and a project's start screen. Copilot shows selected, above the row and in it, and each teammate greyed with a lock; `New` shows its lock. The line under the row says the teammates need a valid Supporter license, with `Enter license key`. Choose a face: the teammate's locked profile opens, with `Enter license key` in its banner. Remove the license key and open the start screen again: the line and the banner read the same. `Recent chats` still shows each teammate's chat with its face.
- Locked teammates dialog: in a vault with teammates, without a Supporter license, choose `New`. "This vault has <n> teammates" shows the teammates' faces with `Enter license key` as the main button, which opens Copilot settings at the license field; `See plans` opens the pricing page. Remove the license key and choose `New` again: the same dialog opens.
- Needs setup: in a vault with a teammate on OpenCode, take OpenCode off this device (in a test vault, clear the OpenCode install from this vault's settings) and open a new chat. The teammate is greyed with a lock; the others are not. Choose it: its profile opens with the reason. Set OpenCode up again: the lock goes without a reload.
- More teammates: narrow the sidebar until faces no longer fit, or add more teammates. `+N More` lists the rest with their titles; choose one and it joins the row, selected.
- Teammate's chat: choose a teammate and send a message. The chat that opens is that teammate's and answers by its instructions.
- Default teammate: start a chat with a teammate, then open a new chat, or reload Copilot and open one. That teammate is selected. Delete its folder and open a new chat: Copilot is selected.
- First message: send a message from the start screen with Enter. The greeting and shelf give way to the conversation, with `New chat`, `Chat history`, and `More actions` above the chat input. Type again without clicking: the text goes into the chat input.
- Shelf tab: choose `Projects`, close Copilot Chat, and open it again. The shelf opens on `Projects`.
- Recent chats: in the vault folder, start a chat in OpenCode itself, outside Copilot, then send a message in a new OpenCode chat in Copilot. `Recent chats` lists the Copilot chat and not the one started outside. Delete the Copilot chat and reload Copilot: it stays gone.
- Search: in `Recent chats`, type part of a chat title into `Search chats...`. Only matching chats remain; clearing the box brings the rest back.
- Teammates' chats: with a Supporter license and Copilot selected, `Recent chats` shows every chat, teammates' chats with their teammate's face. Choose a teammate: only its chats remain. Choose a teammate with no chats: "No chats with <name> yet."
- Archived: choose `View archived`. A list of archived chats and projects opens; `Unarchive` on a project returns it to `Projects` and raises the count.
- Relevant Notes: with a note open beside Copilot Chat, choose `Relevant Notes`. `Relevant to` names the note and related notes are listed.
- Projects: choose `Projects`. `New project`, `Search projects...`, and the projects show; the count on the tab matches the list.
- Project start: enter a project that has chats. The greeting reads `Chat in <project>`, and the shelf has `Files` selected and `Recent chats` for the project. Enter a project with no chats, or open the Navigator: Files shows alone without a tab bar.
- Release update: on a build older than the latest release, open a new chat. The `Copilot <version> is ready` card shows at the bottom; `See what’s new` opens the release notes, and `Dismiss release update` hides the card for that version.

## Gotchas

- The row of faces shows with every license, and with none. Without a Supporter license, `New` and every teammate in it are locked, and only Copilot can be picked.
- In a short window, the space at the top of the start screen and the shelf both give way, the space faster, and the picked teammate's face gets smaller, so the picked teammate, the row and the chat input stay in view.
- A vault's teammate files stay as they are while its teammates show locked: nothing in the teammates folder changes unless a teammate is deleted from its locked profile.
- The locked `New` shows nothing while Copilot is still verifying a stored license at startup, so a Supporter never sees the lock flash.
- Choosing the locked `New` with no license key sends nothing to Brevilabs. With a key, it checks the license and shows the dialog when Brevilabs can't be reached.
- Choosing a face before the first message changes nothing in the vault; only the first message starts the teammate's chat.
- When a teammate's chat cannot start, as on a Codex that needs an update, choosing its face shows a notice with the reason and the new chat stays on Copilot.
- Opening a project's chat from Recent chats or another list outside the project enters that project.
- A chat with no chat note stays in `Recent chats` only while it is among the 500 chats most recently used on this device.
- The release update card shows only on the start screen outside a project.
- Outside a project, the shelf is the same whether or not the Navigator is open, so `Recent chats` and `Projects` repeat what the Navigator lists.
