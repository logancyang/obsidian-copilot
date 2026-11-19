# Agent home

The start screen of a new chat in Agent Chat: a greeting, the [chat input](chat-input.md) for the first message, and the Recent chats / Relevant Notes / Projects shelf.

## Sub-features

- home-greeting: a greeting such as "What can I help with?" above the chat input, picked again for each new chat; inside a project it reads `Chat in <project>`.
- home-agent-row: with Copilot Teammates, the greeting gives way to the picked agent and a row of small faces with names under them: Copilot first, then each agent. Agents that do not fit the sidebar go into a `+N More` menu; the selected agent and Copilot always stay in the row. Long names are cut to one line; hovering a face shows the full name and title.
- home-new-agent: `New` (**+**) at the end of the row opens the [create agent dialog](create-agent-dialog.md); it never moves into `+N More`. With no agents yet, the greeting stays and the row holds Copilot and `New`.
- home-locked-new-agent: without Copilot Teammates in the license, `New` (**+**) shows a small lock and, on hover, "New agent · Supporter preview". The row holds Copilot and `New` under the greeting, with no banner. Choosing `New` checks the license, then opens the "Copilot Teammates is a preview for Supporters" dialog: one line on what an agent does, three points, `Already a Supporter? Enter your license key` (opens the license field in Copilot settings), and `See plans` (opens the pricing page). If the license now includes Copilot Teammates, the [create agent dialog](create-agent-dialog.md) opens instead; once a license with Copilot Teammates is entered after the dialog, the create agent dialog opens by itself.
- home-locked-agents: in a vault with agents and no valid Supporter license (no license key, or a license without Copilot Teammates), the row still shows every agent, greyed with a small lock, and Copilot stays selected. Under the row, "Your agents need a valid Supporter license to chat." with `Enter license key` (opens the license field in Copilot settings). Hovering a face shows its name and title. Choosing a face checks the license, then opens the agent's [locked profile](agent-profile.md); a face never starts a chat. Agent chats keep their faces in `Recent chats` and the [chat tabs](chat-tabs.md).
- home-locked-agents-dialog: in a vault with agents and no valid Supporter license, choosing the locked `New` checks the license, then opens a dialog with the vault's faces and names instead of the Supporter preview. It reads "This vault has <n> agents": "<names> keep their instructions and memory. You need a valid Supporter license to activate them again.", with `See plans` (opens the pricing page) and `Enter license key` first (opens the license field in Copilot settings). With no agents, `New` opens the Supporter preview as before.
- home-first-agent-banner: with Copilot Teammates and no agents yet, a card under the chat input shows the first three [preset faces](create-agent-dialog.md) (grey faces while they load or when they can't) and reads "Give each job its own agent" with `Create your first agent`, which opens the [create agent dialog](create-agent-dialog.md). `Dismiss` hides it for good, and so does the first agent, even after that agent is deleted; `New` stays in the row.
- home-picked-agent: above the row, the selected agent's large face, its name, and its title, with a small gear in the face's corner. Hovering the face grows it slightly and brightens the gear, with the tooltip "Open profile"; choosing it opens the [agent profile](agent-profile.md). For Copilot: Copilot's mark, `Copilot`, and "Classic agent. Starts fresh every chat."; the mark opens nothing. A long name is cut to one line and a long title to two.
- home-agent-default: a new chat starts with the agent of the last chat started, on the start screen and in every project; when that agent is gone, Copilot.
- home-agent-hint: the chat input's hint names the selected agent: "Ask Coco anything • @ to add context • / for commands".
- home-agent-chat: the first message starts a chat with the selected agent, on its model; with Copilot selected, a Copilot chat.
- home-first-message: sending the first message turns the start screen into the conversation, with the [chat controls](chat-controls.md) above the chat input.
- home-shelf: the shelf's `Recent chats`, `Relevant Notes`, and `Projects` tabs, with the project count on `Projects`; the last tab chosen stays selected for every new chat.
- home-recent-chats: `Recent chats` lists past chats as [chat rows](chat-rows.md), pinned chats first, filtered by `Search chats...`. It lists only chats had in Copilot, on every coding agent; a session started with a coding agent outside Copilot does not show.
- home-recent-agent-chats: with Copilot Teammates, each agent chat in `Recent chats` shows its agent's face. With an agent selected, the list holds only that agent's chats and the search reads `Search chats with <name>...`; an agent with no chats yet shows "No chats with <name> yet."
- home-archived: `View archived` under Recent chats lists archived chats and projects, each with `Unarchive`.
- home-relevant-notes: the `Relevant Notes` tab shows [Relevant Notes](relevant-notes.md); it is hidden while the Relevant Notes pane is open.
- home-projects: the `Projects` tab lists [projects](projects.md) with `New project` and `Search projects...`.
- home-project-start: inside a [project](projects.md), the shelf opens on `Files`, with `Recent chats` for that project. Files appears alone when the project has no chats or the [Copilot Navigator](copilot-navigator.md) is open.
- home-setup-locked-agent: an agent whose model can't run on this device, because its coding agent isn't set up here or its model is no longer among that coding agent's enabled models here, shows greyed with the same small lock, named "<name> · Needs setup" to a screen reader, in the row and in `+N More`. Choosing it opens its [profile](agent-profile.md), which says why and what to fix; it never starts a chat, and a new chat never opens on it, even when it was the last chat's agent. A new chat already on it goes back to Copilot. It shows ready again, without a reload, as soon as its model changes or its coding agent is set up. A license without Copilot Teammates shows its own lock instead.
- home-release-update: when a newer Copilot is out, a `Copilot <version> is ready` card offers `See what’s new` for the release notes, and `Dismiss release update`.

## How to get to it

- Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command. A chat with no messages shows the start screen.
- `New chat` (**+**) in the [chat tabs](chat-tabs.md), or `New chat` in the [chat controls](chat-controls.md).
- Enter a project from the `Projects` tab to get that project's start screen.

## Driving it

- Greeting: open a new chat. A greeting shows above the chat input; the next new chat may show a different one.
- Agent row: with Copilot Teammates, open a new chat. The row shows Copilot and each agent's face. Choose an agent, in the row or from `+N More`: its face in the row is ringed in the accent color, its large face with a gear in its corner, name and title show above the row, and the chat input reads "Ask <name> anything". Hover the large face: it grows slightly and the gear brightens. Choose it, or press Tab to it and then Enter: the [agent profile](agent-profile.md) covers the start screen. Choose Copilot: its face takes the ring, and `Copilot` with "Classic agent. Starts fresh every chat." shows above the row, and Copilot's mark has no gear.
- New agent: with Copilot Teammates, choose `New` in the row. The [create agent dialog](create-agent-dialog.md) opens; after `Create`, the new agent is in the row, selected. In a vault with no agents, the greeting shows above Copilot and `New`.
- Locked new agent: with a license without Copilot Teammates, or none, open a new chat and in a project too. `New` shows a lock; hovering it shows "New agent · Supporter preview"; no banner shows. Choose `New`: the "Copilot Teammates is a preview for Supporters" dialog opens. `See plans` opens the pricing page and closes the dialog. `Already a Supporter? Enter your license key` opens Copilot settings at the license field; enter a license with Copilot Teammates and the create agent dialog opens by itself, with `New` unlocked.
- Locked agents: in a vault with agents, with a license that does not include Copilot Teammates, open a new chat and a project's start screen. Copilot shows selected, above the row and in it, and each agent greyed with a lock; `New` shows its lock. The line under the row says the agents need a valid Supporter license, with `Enter license key`. Choose a face: the agent's locked profile opens, with `Enter license key` in its banner. Remove the license key and open the start screen again: the line and the banner read the same. `Recent chats` still shows each agent chat with its face.
- Locked agents dialog: in a vault with agents, with a license that does not include Copilot Teammates, choose `New`. "This vault has <n> agents" shows the agents' faces and leads with `Enter license key`, which opens Copilot settings at the license field; `See plans` opens the pricing page. Remove the license key and choose `New` again: the same dialog opens.
- Agent needs setup: in a vault with an agent on OpenCode, take OpenCode off this device (in a test vault, clear the OpenCode install from this vault's settings) and open a new chat. The agent is greyed with a lock; the others are not. Choose it: its profile opens with the reason. Set OpenCode up again: the lock goes without a reload.
- First agent banner: with Copilot Teammates in a vault with no agents, open a new chat. The card shows under the chat input with three preset faces. Choose `Create your first agent` and create an agent: the card is gone. In another vault with no agents, choose `Dismiss`, then reload Copilot: the card stays gone and `New` is still in the row.
- More agents: narrow the sidebar until faces no longer fit, or add more agents. `+N More` lists the rest with their titles; choose one and it joins the row, selected.
- Agent chat: choose an agent and send a message. The chat that opens is that agent's and answers by its instructions.
- Default agent: start a chat with an agent, then open a new chat, or reload Copilot and open one. That agent is selected. Delete its folder and open a new chat: Copilot is selected.
- First message: send a message from the start screen. The greeting and shelf give way to the conversation, with `New chat`, `Chat history`, and `More actions` above the chat input.
- Shelf tab: choose `Projects`, close Agent Chat, and open it again. The shelf opens on `Projects`.
- Recent chats: in the vault folder, start an OpenCode session outside Copilot, then send a message in a new OpenCode chat in Copilot. `Recent chats` lists the Copilot chat and not the outside session. Delete the Copilot chat and reload Copilot: it stays gone.
- Search: in `Recent chats`, type part of a chat title into `Search chats...`. Only matching chats remain; clearing the box brings the rest back.
- Agent chats: with Copilot Teammates and Copilot selected, `Recent chats` shows every chat, agent chats with their agent's face. Choose an agent: only its chats remain. Choose an agent with no chats: "No chats with <name> yet."
- Archived: choose `View archived`. A list of archived chats and projects opens; `Unarchive` on a project returns it to `Projects` and raises the count.
- Relevant Notes: with a note open beside Agent Chat, choose `Relevant Notes`. `Relevant to` names the note and related notes are listed.
- Projects: choose `Projects`. `New project`, `Search projects...`, and the projects show; the count on the tab matches the list.
- Project start: enter a project that has chats. The greeting reads `Chat in <project>`, and the shelf has `Files` selected and `Recent chats` for the project. Enter a project with no chats, or open the Navigator: Files shows alone without a tab bar.
- Release update: on a build older than the latest release, open a new chat. The `Copilot <version> is ready` card shows at the bottom; `See what’s new` opens the release notes, and `Dismiss release update` hides the card for that version.

## Gotchas

- The row of faces shows with every license, and with none. Without Copilot Teammates in the license, `New` and every agent in it are locked, and only Copilot can be picked.
- In a short window, the space at the top of the start screen and the shelf both give way, the space faster, and the picked agent's face gets smaller, so the picked agent, the row and the chat input stay in view.
- A vault's agent files stay as they are while its agents show locked: nothing in the agents folder changes unless an agent is deleted from its locked profile.
- The locked `New` shows nothing while Copilot is still verifying a stored license at startup, so a Supporter never sees the lock flash.
- Choosing the locked `New` with no license key sends nothing to Brevilabs. With a key, it checks the license and shows the dialog when Brevilabs can't be reached.
- Choosing a face before the first message changes nothing in the vault; only the first message starts the agent's chat.
- When an agent's chat cannot start, as on a Codex that needs an update, choosing its face shows a notice with the reason and the new chat stays on Copilot.
- Opening a project's chat from Recent chats or another list outside the project enters that project.
- A chat with no chat note stays in `Recent chats` only while it is among the 500 chats most recently used on this device.
- The release update card and the first agent banner show only on the start screen outside a project.
- Outside a project, the shelf is the same whether or not the Navigator is open, so `Recent chats` and `Projects` repeat what the Navigator lists.
