# Quick Chat

Quick Chat is Copilot V4's lightweight conversation view. Use it for a short question, rewrite, or discussion with note context.

For multi-step work, native agent tools, reusable skills, permissioned file changes, or Agent project context, use **Agent** instead. On desktop, click **Open Copilot Agent Chat** in the ribbon or run **Open Copilot Agent Chat Window** from the command palette. See [Agents in Copilot V4](agent-mode-and-tools.md).

Quick Chat's V3 chat window will be deprecated soon. On desktop, use **Agent with opencode** for bring-your-own-key and Copilot-hosted models. The small, always-visible link inside the message box, directly above its controls, opens Agent for you.

## Open Quick Chat

Run **Open Copilot Chat Window** from the command palette. On mobile, the Copilot ribbon button opens Quick Chat because Agent requires desktop Obsidian.

At the top of Quick Chat, choose **chat (free)** for a standard conversation. The selector also shows **copilot plus**, which requires a paid license. It is a paid Quick Chat workflow, not Agent. Agent is a separate view and does not appear in this selector.

## Choose a model

Use the model picker below the message box. It shows only models enabled under **Settings → Copilot → Basic → Agents → Quick Chat**, including Copilot Plus and bring-your-own-key models.

The **Default model** in that settings panel controls which model a new Quick Chat starts with. See [Models and Parameters](models-and-parameters.md) to manage the list.

## Ask with context

Quick Chat can include the active note, selected text, other notes, folders, and images; on desktop it can also include open Web Viewer tabs. The selected model must support images. Context appears above the message box, where you can review or remove it before sending.

- Use **Add context** (`+`) or type `@` to find context.
- Type `[[Note Title]]` to reference a note directly.

By default, a new chat includes the active note. A text selection takes priority over the full active note. For all supported context types, see [Context and Mentions](context-and-mentions.md).

## Send and manage messages

Press **Enter** to send by default. You can switch this to **Shift + Enter** under **Settings → Copilot → Basic → General → Send Shortcut**. Use the stop button to interrupt a response.

Hover over a message to use its actions:

- Your messages: **Copy**, **Edit**, and **Delete**.
- Copilot responses: **Show Sources** when available, **Insert / Replace at cursor**, **Copy**, **Regenerate**, and **Delete**.

After a response, the token counter in the top bar shows the context used for the latest response when the provider reports token usage.

## Start or reopen a chat

Use **New Chat** in the top bar or run **New Copilot Quick Chat**. Starting over clears the current messages and resets context to the active note when automatic context is enabled.

Use **Chat History** to search saved conversations, reopen one, rename it, open its Markdown source, or delete it.

**Autosave Chat as Markdown** is enabled by default. Copilot saves after each user message and response under `<Copilot folder>/copilot-conversations/`. If autosave is off, use **Save Chat as Note** in the top bar. Change autosave and **Conversation Filename Template** under **Settings → Copilot → Basic → Saving conversations**.

## Chat settings

Use **Chat Settings** (gear) to choose a **System Prompt** for the current chat or reset the session choice. These settings do not configure Agent, which reads `AGENTS.md` instead. See [System Prompts](system-prompts.md).

Use **Advanced Settings** (`…`) to toggle **Suggested Prompt** and **Auto-accept Edits**.

## Quick Ask

For one question or rewrite without opening a chat pane, run **Quick Ask** from the command palette or the editor's **Copilot** menu. Quick Ask uses a Quick Chat model, not the model in your Agent session. See [Copilot Commands and Quick Ask](custom-commands.md#quick-ask).

## Related

- [Getting Started](getting-started.md)
- [Agents in Copilot V4](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Context and Mentions](context-and-mentions.md)
