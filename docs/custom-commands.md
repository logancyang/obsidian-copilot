# Copilot Commands and Quick Ask

Copilot commands are prompts you save once and reuse. They are best for repeatable jobs such as fixing grammar, summarizing a note, or rewriting selected text.

For a fast question or rewrite while you are editing, use **Quick Ask** instead.

## Commands or skills?

Commands and skills can appear when you type `/`, but only Agent resolves slash invocations. Outside Agent, run saved commands from the editor or command palette. They serve different purposes:

| Use                 | Best for                                                                     | Managed in                       |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| **Copilot command** | A short, repeatable prompt with optional note variables                      | **Settings → Copilot → Command** |
| **Skill**           | A reusable agent workflow that can include instructions and supporting files | **Settings → Copilot → Skills**  |

Skills can be shared with opencode, Claude, and Codex. Commands stay inside Copilot and also work from the editor and Obsidian command palette. If a command and skill have the same name, the skill takes the slash-menu spot.

## Create a command

1. Open **Settings → Copilot → Command**.
2. Click **Add Cmd**.
3. Enter a **Name** and **Prompt**.
4. Optionally choose **Model (Optional)**, **Show in context menu**, and **Show in slash menu**.
5. Click **Save**.

Choose **Inherit from chat model** when the command should use your current Quick Chat model. A command-specific model applies to editor and command-palette runs; a slash run in Agent uses the current Agent session.

Use **Generate Default** for a starter set. You can edit, duplicate, delete, or drag commands to reorder them. **Custom Prompts Sort Strategy** controls their order in the slash menu.

### Add note context to a prompt

With **Custom Prompt Templating** enabled, these variables add vault context:

| Variable           | Adds                                                       |
| ------------------ | ---------------------------------------------------------- |
| `{}`               | Selected text, or the active note when nothing is selected |
| `{activeNote}`     | The active note                                            |
| `{[[Note Title]]}` | A specific note                                            |
| `{Folder/Path}`    | Notes in a folder path                                     |
| `{#tag1, #tag2}`   | Notes with any listed property tag                         |

For example:

```text
Rewrite {} as a concise project update. Match the style of {[[Writing Guide]]}.
```

Tags must be in note properties, not only written inline in the note body. When you run a command from Agent, the agent resolves note, folder, and tag references with its vault tools.

## Run a command

- **From the editor:** select text if needed, then right-click and choose **Copilot → _command name_**. The command must have **Show in context menu** enabled.
- **From the command palette:** run **Apply custom command**, then choose any command. Each saved command is also registered by name in the palette.
- **From Agent:** type `/`, choose a command, add any extra instruction, and send. Choosing an item inserts it without sending, so you can review it first.

Editor and command-palette runs open a result panel. You can refine the result, copy it, insert it at the cursor, or replace the original selection.

## Quick Ask

**Quick Ask** is the fastest inline flow for a question, explanation, or rewrite.

1. Select text, or place the cursor where you are working.
2. Run **Quick Ask** from the command palette, or choose **Copilot → Quick Ask** from the editor menu. You can assign a hotkey under **Obsidian Settings → Hotkeys**.
3. Ask your question. Use the model picker if needed, and enable **Note** to include the full active note.
4. Use **Copy to clipboard**, **Insert at cursor**, or **Replace selection** on the answer. You can continue with follow-up questions in the same panel.

Quick Ask uses a Quick Chat model configured through Copilot Plus or BYOK, not the model inside an Agent session. Its model and **Note** choices are remembered and shared with **Trigger quick command**.

Quick Ask is unavailable in Source mode. **Replace selection** appears only when text was selected and stays available only while Copilot can safely identify the original text in the same note and editor pane.

## Quick Command

Run **Trigger quick command** when you want a one-off instruction for selected text without saving a command. A selection is required. The panel uses the same model and **Note** preference as Quick Ask and offers the same copy, insert, and replace actions.

Quick Command is also unavailable in Source mode.

## Where commands are stored

Each command is a Markdown file in `<Copilot folder>/copilot-custom-prompts/`. The filename is the command name, and Copilot keeps file changes and the **Command** settings tab in sync. Change the root under **Settings → Copilot → Basic → Copilot folder location**.

When upgrading from older command settings, Copilot migrates supported commands to these files. If a name cannot be migrated, Copilot keeps it under the `unsupported/` subfolder and shows a startup notice.

## Related

- [Agents in Copilot V4](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Getting Started](getting-started.md)
