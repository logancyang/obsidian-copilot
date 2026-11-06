# Multi-surface journeys

The main things a user does in Agent Mode, walked through the features each one crosses. Read a journey to see how the parts fit together; each step's controls and rules are in the linked feature's file.

## Start a first chat

The user opens Agent Chat and gets an answer.

- If no agent is ready, Agent Chat shows `Select your agent`. Install or sign in from [agent setup](agent-setup.md).
- The [start screen](agent-home.md) shows a greeting and the [chat input](chat-input.md). Type a message and send it.
- The start screen turns into the conversation, and the reply streams in ([agent replies](agent-replies.md)).
- The chat now has a [row](chat-rows.md) in Recent chats, and its note opens from `More actions` → `Open chat note` in the [chat controls](chat-controls.md).

Touches: [agent setup](agent-setup.md), [agent home](agent-home.md), [chat input](chat-input.md), [agent replies](agent-replies.md), [chat rows](chat-rows.md), [chat controls](chat-controls.md).

## Have the agent change a note

The user asks the agent to edit their vault and checks what it did.

- Ask for a change in the [chat input](chat-input.md), adding the note with a mention if needed.
- Depending on the mode, the agent asks first with `Permission required` ([decision cards](decision-cards.md)).
- The turn ends with the files it changed ([turn diffs](turn-diffs.md)). Open one to see the changes marked in the note, and `Revoke` any change to undo it.

Touches: [chat input](chat-input.md), [decision cards](decision-cards.md), [agent replies](agent-replies.md), [turn diffs](turn-diffs.md).

## Go back to a past chat

The user continues an earlier conversation.

- Find it in Recent chats on the [start screen](agent-home.md), in `Chat history` in the [chat controls](chat-controls.md), or in the [Copilot Navigator](copilot-navigator.md). Each lists it as a [chat row](chat-rows.md).
- Choose the row. The chat opens with its messages, in a [tab](chat-tabs.md) while the tabs show.
- Send a message to pick up where it left off.

Touches: [agent home](agent-home.md), [chat controls](chat-controls.md), [Copilot Navigator](copilot-navigator.md), [chat rows](chat-rows.md), [chat tabs](chat-tabs.md).

## Run several chats at once

The user keeps more than one agent working.

- Send a message in one chat, then choose `New chat` (**+**) in the [chat tabs](chat-tabs.md) and start another.
- The first chat keeps replying in its background tab, which shows a dot until the user switches back to it.
- Close a tab where a message was sent. Its agent keeps working, and its [row](chat-rows.md) offers `Close chat` to stop it.
- In the [Copilot Navigator](copilot-navigator.md), chats with a running agent show `Session open`.

Touches: [chat tabs](chat-tabs.md), [chat rows](chat-rows.md), [Copilot Navigator](copilot-navigator.md), [agent replies](agent-replies.md).

## Work in a project

The user groups chats and context around one piece of work.

- On the [start screen](agent-home.md), open the `Projects` tab and choose `New project`, or choose an existing [project](projects.md) to enter it.
- Inside, the start screen reads `Chat in <project>`, lists only the project's chats, and shows its `Context`. The [chat tabs](chat-tabs.md) show only the project's chats.
- Chats started here belong to the project. `Leave project` returns to the other chats.

Touches: [agent home](agent-home.md), [projects](projects.md), [chat tabs](chat-tabs.md).

## Recover when something goes wrong

The user hits an error and gets unstuck.

- A failed reply shows `<agent> ran into a problem` with `Retry` ([decision cards](decision-cards.md)). An agent that cannot start offers its fix, such as `Sign in` ([agent setup](agent-setup.md)).
- If it keeps failing, `Report this to the Copilot team?` offers `Review & report`, which opens [Report an issue](report-issue.md) with the chat's details. `More actions` → `Report an issue` in the [chat controls](chat-controls.md) opens it any time.

Touches: [decision cards](decision-cards.md), [agent setup](agent-setup.md), [report issue](report-issue.md), [chat controls](chat-controls.md).
