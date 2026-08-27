# Quick Chat

Quick Chat is Copilot V4's lightweight conversation view. Use it for a short question, rewrite, or discussion that does not need agent tools or a project workspace.

On desktop, start with **Agent Chat** for multi-step work, reusable Skills, permissioned file changes, or project context. Click **Open Copilot Agent Chat** in the ribbon or run **Open Copilot Agent Chat Window** from the command palette. On mobile, where Agent Chat is unavailable, Quick Chat is the main conversation view. See [Agent Chat](agent-mode-and-tools.md).

## Open Quick Chat

Run **Open Copilot Chat Window** from the command palette. On mobile, the Copilot ribbon button opens Quick Chat because Agent Chat requires desktop Obsidian.

## Choose a model

Use the model picker below the message box. It shows only models enabled under **Settings → Copilot → Basic → Agents → Quick Chat**, including Copilot-hosted and bring-your-own-key models.

The **Default model** in that settings panel controls which model a new Quick Chat starts with. See [Models, Effort, and Permissions](models-and-parameters.md) to manage the list.

## Ask with context

Quick Chat can include the active note, selected text, other notes, folders, and images; on desktop it can also include open Web Viewer tabs. The selected model must support images. Context appears above the message box, where you can review or remove it before sending.

- Use **Add context** (`+`) or type `@` to find context.
- Type `[[Note Title]]` to reference a note directly.

By default, a new chat includes the active note. A text selection takes priority over the full active note. For all supported context types, see [Context and Mentions](context-and-mentions.md).

## Run a saved command

Type `/` and choose a saved command. You can add an instruction after the command name before sending. When you send, Quick Chat replaces `/command-name` with the saved command prompt followed by your extra instruction, matching Agent Chat.

Manage saved commands under **Settings → Copilot → Command**. See [Copilot Commands and Quick Ask](custom-commands.md).

## Send and manage messages

Press **Enter** to send by default. You can switch this to **Shift + Enter** under **Settings → Copilot → Basic → General → Send Shortcut**. Use the stop button to interrupt a response.

Hover over a message to use its actions:

- Your messages: **Copy**, **Edit**, and **Delete**.
- Copilot responses: **Insert / Replace at cursor**, **Copy**, **Regenerate**, and **Delete**.

Your messages collapse after 12 lines. Select **Show more** to read the full message or **Show less** to collapse it again. Copy and Edit still use the complete message.

After a response, the token counter in the top bar shows the context used for the latest response when the provider reports token usage.

## Start or reopen a chat

Use **New Chat** in the top bar or run **New Copilot Quick Chat**. Starting over clears the current messages and resets context to the active note when automatic context is enabled.

Use **Chat History** to search saved conversations, reopen one, rename it, open its Markdown source, or delete it.

**Autosave Chat as Markdown** is enabled by default. Copilot saves after each user message and response under `<Copilot folder>/copilot-conversations/`. If autosave is off, use **Save Chat as Note** in the top bar. Change autosave and **Conversation Filename Template** under **Settings → Copilot → Basic → Saving conversations**.

## Chat settings

Use **Chat Settings** (gear) to choose a **System Prompt** for the current chat or reset the session choice. These settings do not configure Agent Chat, which reads `AGENTS.md` instead. See [Instructions for Agent Chat and Quick Chat](system-prompts.md).

## Quick Ask

For one question or rewrite without opening a chat pane, run **Quick Ask** from the command palette or the editor's **Copilot** menu. Quick Ask uses a Quick Chat model, not the model in your Agent Chat session. See [Copilot Commands and Quick Ask](custom-commands.md#quick-ask).

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Copilot Commands and Quick Ask](custom-commands.md)
- [Context and Mentions](context-and-mentions.md)
