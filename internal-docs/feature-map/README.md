# Copilot feature map

A behavior-level inventory of Agent Mode, one file per part of the screen a user can point at. Agents use it to decide what to drive and what evidence counts; humans use it as the regression checklist. To add or change an entry, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).

The map holds what has been mapped so far, not everything the product does. An entry's sub-features can miss capabilities. When a change touches behavior the map does not describe, drive that behavior too, and add it to the entry.

## Baseline

- This working tree's build is deployed into your own scratch vault, per [`TESTING_GUIDE.md`](../TESTING_GUIDE.md), "End-to-end testing". Never drive a vault you did not create for this run.
- Agent Chat is open, its agent has finished starting, and Recent chats lists at least two past chats.
- Find controls by their visible name or tooltip, within the pane under test.
- Replies stream. Wait for the reply to finish, not for a fixed time.
- "Sent a message" means a message sent since Obsidian started.

## Proof and skip reporting

The feature file a change touches defines its coverage set. Also drive every journey in [`multi-surface-journeys.md`](multi-surface-journeys.md) whose `Touches:` line names a feature the change affects.

- Exercise every entry point and every path the change can affect.
- Record the action and the resulting screen, not only the final one.
- A chat's agent is running when its row offers `Close chat` or shows `Session open`.
- When a path is unreachable, name it and what blocks it (license, OS, an agent not installed), then cover the closest path that remains.

## Start

- [agent-home](agent-home.md): the start screen: a greeting, the chat input for the first message, and the Recent chats / Relevant Notes / Projects shelf.

## Chats

- [chat-tabs](chat-tabs.md): tabs across the top of Agent Chat, one per open chat.
- [copilot-navigator](copilot-navigator.md): the sidebar listing chats and projects.
- [chat-rows](chat-rows.md): one chat in a list, wherever chats are listed.
- [chat-controls](chat-controls.md): the bar above the chat input: New chat, Chat history, Usage, More actions.

## Conversation

- [chat-input](chat-input.md): model, mode, and effort pickers, mentions, note context, images, send, stop.
- [queued-messages](queued-messages.md): messages queued while the agent works.
- [agent-replies](agent-replies.md): streaming text, reasoning, tool and activity cards, subagents, tasks.
- [decision-cards](decision-cards.md): cards in the conversation that wait on the user: permission requests, questions from the agent, plan proposals, status and error cards.
- [turn-diffs](turn-diffs.md): file changes per turn, Revoke.

## Projects and setup

- [projects](projects.md): create, enter, project header and info, project files and context.
- [relevant-notes](relevant-notes.md): Relevant Notes in the start screen's shelf and in its own pane.
- [agent-setup](agent-setup.md): choose and install an agent, sign in, default model and effort.
- [report-issue](report-issue.md): the Report an issue flow.

## Multi-surface journeys

- [multi-surface-journeys](multi-surface-journeys.md): the main things a user does, walked through the features each one crosses.

## Entry contract

A fully mapped feature file uses these four H2s, in order. A `(sub-features only)` file has just the first.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it`
4. `Gotchas`
