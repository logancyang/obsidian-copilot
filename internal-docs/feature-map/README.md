# Copilot feature map

A behavior-level inventory of Agent Mode, one file per part of the screen a user can point at. Agents use it to decide what to drive and what evidence counts; humans use it as the regression checklist. To add or change an entry, follow [`FEATURE_MAP_GUIDE.md`](../FEATURE_MAP_GUIDE.md).

## Baseline

- This working tree's build is deployed into your own scratch vault, per [`TESTING_GUIDE.md`](../TESTING_GUIDE.md), "End-to-end testing". Never drive a vault you did not create for this run.
- Agent Chat is open, its agent has finished starting, and Recent chats lists at least two past chats.
- Drive through the Obsidian CLI. Find controls by their visible name or tooltip, within the pane under test.
- Replies stream. Wait for the reply to finish, not for a fixed time.
- "Sent a message" means a message sent since Obsidian started.

## Proof and skip reporting

The feature file a change touches defines its coverage set. When a change spans tabs, the Navigator, or projects, also drive [`multi-surface-journeys.md`](multi-surface-journeys.md).

- Exercise every entry point and every path the change can affect.
- Record the action and the resulting screen, not only the final one.
- When a path is unreachable, name it and what blocks it (license, OS, an agent not installed), then cover the closest path that remains.

## Start

- `agent-home` (not mapped yet): the start screen, agent picker, the Recent chats / Relevant Notes / Projects shelf, first message.

## Chats

- [chat-tabs](chat-tabs.md): tabs across the top of Agent Chat, one per open chat.
- [copilot-navigator](copilot-navigator.md): the sidebar listing chats and projects.
- [chat-rows](chat-rows.md): one chat in a list, wherever chats are listed.
- `chat-controls` (not mapped yet): the bar above the chat input, with New chat and the history button.

## Conversation

- `chat-input` (not mapped yet): model, mode, and effort pickers, mentions, note context, images, send, stop, context meter.
- `queued-messages` (not mapped yet): messages queued while the agent works.
- `agent-replies` (not mapped yet): streaming text, reasoning, tool and activity cards, subagents, tasks.
- `agent-prompts` (not mapped yet): permission cards, questions from the agent, plan proposals, status and error cards.
- `turn-diffs` (not mapped yet): file changes per turn, Revoke.

## Projects and setup

- `projects` (not mapped yet): create, enter, project header and info, project files.
- `agent-setup` (not mapped yet): choose and install an agent, sign in, default model and effort.
- `report-issue` (not mapped yet): the Report an issue flow.

## Multi-surface journeys

- [multi-surface-journeys](multi-surface-journeys.md): what keeps a chat's agent running across tabs, the Navigator, and projects.

## Entry contract

Every feature file uses the same four H2s:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with the Obsidian CLI`
4. `Gotchas`
