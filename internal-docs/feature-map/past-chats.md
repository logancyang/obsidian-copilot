# Go back to a past chat

Aliases: chat history, Recent chats, Copilot Navigator.

A user finds an earlier chat and continues it, and can browse past chats without leaving agents running.

## Sub-features

- Find past chats in Recent chats, the chat history list, or the Copilot Navigator.
- Reopening a chat brings back its whole conversation. A chat still open somewhere comes back as that same live chat.
- Browsing chats in the Navigator leaves no agents running behind it, except chats the user sent a message in. Those are marked as open.
- Close chat in the history list or the Navigator stops a chat's agent without deleting the chat.
- Past chats are kept across restarts.

## How to get to it

Recent chats on the Agent Chat start screen, the history button above the message box, or the **Open Copilot Navigator** command. The Navigator needs a license with Navigator access.

## Driving it

Setup per [README](README.md).

1. Open a past chat from Recent chats. Its conversation shows, and it opens alongside any chat the user already had open.
2. In the Navigator, open one chat without sending anything, then another. The first is no longer marked as open.
3. Send a message in a chat, then open another from the Navigator. The first stays marked as open.

## Gotchas

- While the Navigator is open, the tabs are hidden. Moving to another chat from inside Agent Chat (rather than from the Navigator) does not stop the chat left behind.
- Whether a reopened chat continues the same agent conversation depends on the agent still having it; if not, the conversation is shown from the saved copy and the agent gets that history with the next message.
