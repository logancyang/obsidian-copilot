# Agent home

The start screen of a new chat in Agent Chat: a greeting, the [chat input](chat-input.md) for the first message, and the Recent chats / Relevant Notes / Projects shelf.

## Sub-features

- home-greeting: a greeting such as "What can I help with?" above the chat input, picked again for each new chat; inside a project it reads `Chat in <project>`.
- home-agent-row: with custom agents, the greeting gives way to "Who do you want to talk to?" and a row of faces with names under them: Copilot first, then each agent. Agents that do not fit the sidebar go into a `+N More` menu; the selected agent and Copilot always stay in the row. Long names are cut to one line; hovering a face shows the full name and title.
- home-new-agent: `New` (**+**) at the end of the row opens the [create agent dialog](create-agent-dialog.md); it never moves into `+N More`. With no agents yet, the greeting stays and the row holds Copilot and `New`.
- home-locked-new-agent: without custom agents in the license, `New` (**+**) shows a small lock and, on hover, "New agent · Supporter preview". The row holds Copilot and `New` under the greeting, with no banner. Choosing `New` checks the license, then opens the "Custom Agent is a preview for Supporters" dialog: one line on what an agent does, three points, `Already a Supporter? Enter your license key` (opens the license field in Copilot settings), and `See plans` (opens the pricing page). If the license now includes custom agents, the [create agent dialog](create-agent-dialog.md) opens instead; once a license with custom agents is entered after the dialog, the create agent dialog opens by itself.
- home-locked-agents: when the license no longer includes custom agents (a lapsed Supporter plan, or a paid plan without them), or on a device with no license key that has agents in its vault (as Sync brings them), the row still shows every agent, greyed with a small lock, and Copilot stays selected. Under the row, "Your Supporter plan ended. Your agents and their files are still here." with `Renew`, or, without an active paid plan on the device, "This vault's agents can't chat until you enter a Supporter license key on this device." with `Enter license key`. Hovering a face shows its name and title. Choosing a face checks the license, then opens the agent's [locked profile](agent-profile.md); a face never starts a chat. Agent chats keep their faces in `Recent chats` and the [chat tabs](chat-tabs.md).
- home-first-agent-banner: with custom agents and no agents yet, a card under the chat input reads "Give each job its own agent" with `Create your first agent`, which opens the [create agent dialog](create-agent-dialog.md). `Dismiss` hides it for good, and so does the first agent, even after that agent is deleted; `New` stays in the row.
- home-agent-line: one line under the row names the selected agent's title followed by `Profile`, which opens the [agent profile](agent-profile.md), or "No agent, no memory" for Copilot.
- home-agent-default: a new chat starts with the agent of the last chat started, on the start screen and in every project; when that agent is gone, Copilot.
- home-agent-hint: the chat input's hint names the selected agent: "Ask Coco anything • @ to add context • / for commands".
- home-agent-chat: the first message starts a chat with the selected agent, on its model; with Copilot selected, a Copilot chat.
- home-first-message: sending the first message turns the start screen into the conversation, with the [chat controls](chat-controls.md) above the chat input.
- home-shelf: the shelf's `Recent chats`, `Relevant Notes`, and `Projects` tabs, with the project count on `Projects`; the last tab chosen stays selected for every new chat.
- home-recent-chats: `Recent chats` lists past chats as [chat rows](chat-rows.md), pinned chats first, filtered by `Search chats...`.
- home-recent-agent-chats: with custom agents, each agent chat in `Recent chats` shows its agent's face. With an agent selected, the list holds only that agent's chats and the search reads `Search chats with <name>...`; an agent with no chats yet shows "No chats with <name> yet."
- home-archived: `View archived` under Recent chats lists archived chats and projects, each with `Unarchive`.
- home-relevant-notes: the `Relevant Notes` tab shows [Relevant Notes](relevant-notes.md); it is hidden while the Relevant Notes pane is open.
- home-projects: the `Projects` tab lists [projects](projects.md) with `New project` and `Search projects...`.
- home-project-start: inside a [project](projects.md), the shelf opens on `Files`, with `Recent chats` for that project. Files appears alone when the project has no chats or the [Copilot Navigator](copilot-navigator.md) is open.
- home-release-update: when a newer Copilot is out, a `Copilot <version> is ready` card offers `See what’s new` for the release notes, and `Dismiss release update`.

## How to get to it

- Open Agent Chat from the ribbon icon or the `Open Copilot Agent Chat window` command. A chat with no messages shows the start screen.
- `New chat` (**+**) in the [chat tabs](chat-tabs.md), or `New chat` in the [chat controls](chat-controls.md).
- Enter a project from the `Projects` tab to get that project's start screen.

## Driving it

- Greeting: open a new chat. A greeting shows above the chat input; the next new chat may show a different one.
- Agent row: with custom agents, open a new chat. "Who do you want to talk to?" shows Copilot and each agent's face. Choose an agent: its face is ringed, its title and `Profile` show under the row, and the chat input reads "Ask <name> anything". Choose `Profile`: the [agent profile](agent-profile.md) covers the start screen. Choose Copilot: "No agent, no memory", with no `Profile`.
- New agent: with custom agents, choose `New` in the row. The [create agent dialog](create-agent-dialog.md) opens; after `Create`, the new agent is in the row, selected. In a vault with no agents, the greeting shows above Copilot and `New`.
- Locked new agent: after custom agents have launched, with a license without custom agents, or none, open a new chat and in a project too. `New` shows a lock; hovering it shows "New agent · Supporter preview"; no banner shows. Choose `New`: the "Custom Agent is a preview for Supporters" dialog opens. `See plans` opens the pricing page and closes the dialog. `Already a Supporter? Enter your license key` opens Copilot settings at the license field; enter a license with custom agents and the create agent dialog opens by itself, with `New` unlocked.
- Locked agents: after custom agents have launched, in a vault with agents, with a license that no longer includes custom agents, open a new chat and a project's start screen. "Who do you want to talk to?" shows Copilot selected and each agent greyed with a lock; `New` shows its lock. The line under the row says the plan ended, with `Renew`. Choose a face: the agent's locked profile opens, with `Renew` in its banner. Remove the license key and choose a face again: the line and the banner lead with `Enter license key`. `Recent chats` still shows each agent chat with its face.
- First agent banner: with custom agents in a vault with no agents, open a new chat. The card shows under the chat input. Choose `Create your first agent` and create an agent: the card is gone. In another vault with no agents, choose `Dismiss`, then reload Copilot: the card stays gone and `New` is still in the row.
- More agents: narrow the sidebar until faces no longer fit, or add more agents. `+N More` lists the rest with their titles; choose one and it joins the row, selected.
- Agent chat: choose an agent and send a message. The chat that opens is that agent's and answers by its instructions.
- Default agent: start a chat with an agent, then open a new chat, or reload Copilot and open one. That agent is selected. Delete its folder and open a new chat: Copilot is selected.
- First message: send a message from the start screen. The greeting and shelf give way to the conversation, with `New chat`, `Chat history`, and `More actions` above the chat input.
- Shelf tab: choose `Projects`, close Agent Chat, and open it again. The shelf opens on `Projects`.
- Search: in `Recent chats`, type part of a chat title into `Search chats...`. Only matching chats remain; clearing the box brings the rest back.
- Agent chats: with custom agents and Copilot selected, `Recent chats` shows every chat, agent chats with their agent's face. Choose an agent: only its chats remain. Choose an agent with no chats: "No chats with <name> yet."
- Archived: choose `View archived`. A list of archived chats and projects opens; `Unarchive` on a project returns it to `Projects` and raises the count.
- Relevant Notes: with a note open beside Agent Chat, choose `Relevant Notes`. `Relevant to` names the note and related notes are listed.
- Projects: choose `Projects`. `New project`, `Search projects...`, and the projects show; the count on the tab matches the list.
- Project start: enter a project that has chats. The greeting reads `Chat in <project>`, and the shelf has `Files` selected and `Recent chats` for the project. Enter a project with no chats, or open the Navigator: Files shows alone without a tab bar.
- Release update: on a build older than the latest release, open a new chat. The `Copilot <version> is ready` card shows at the bottom; `See what’s new` opens the release notes, and `Dismiss release update` hides the card for that version.

## Gotchas

- The row of faces, `Profile`, and `New` need a license that includes custom agents (a team license until launch). Without one, the start screen shows the greeting as before. The locked `New` and its dialog show only after launch, for every license without custom agents.
- A vault's agent files stay as they are while its agents show locked: nothing in the agents folder changes unless an agent is deleted from its locked profile.
- The locked `New` shows nothing while Copilot is still verifying a stored license at startup, so a Supporter never sees the lock flash.
- Choosing the locked `New` checks the license with Brevilabs even with no license key, and shows the dialog when Brevilabs can't be reached.
- Choosing a face before the first message changes nothing in the vault; only the first message starts the agent's chat.
- When an agent's chat cannot start, as on a Codex that needs an update, choosing its face shows a notice with the reason and the new chat stays on Copilot.
- Opening a project's chat from Recent chats or another list outside the project enters that project.
- The release update card and the first agent banner show only on the start screen outside a project.
- Outside a project, the shelf is the same whether or not the Navigator is open, so `Recent chats` and `Projects` repeat what the Navigator lists.
