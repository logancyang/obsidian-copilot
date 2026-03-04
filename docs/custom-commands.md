# Custom Commands

Custom commands are preset AI prompts you define once and reuse on any note or selected text. They're stored as markdown files in your vault and can be triggered from the right-click context menu, the command palette, or as slash commands in chat.

---

## Overview

A custom command is like a template prompt. You write an instruction (with optional variables) and save it. From then on, you can apply it to any note or selected text with a single click.

**Examples of what you might create:**
- "Summarize this note in bullet points"
- "Extract all action items as a task list"
- "Rewrite this in a more formal tone"
- "Translate to Spanish"
- "Create a Fleeting Note from this"

---

## Creating a Custom Command

### From Settings

1. Go to **Settings → Copilot → Command**
2. Click **Add new command**
3. Fill in the fields:
   - **Name** — What the command is called (also becomes its ID)
   - **Prompt** — The instruction to send to the AI
   - **Show in context menu** — Whether it appears when right-clicking text in a note
   - **Model** — Optional: use a specific model for this command (defaults to the current chat model)
4. Save

### From the Command Palette

You can also create a command on the fly:

1. Open the command palette (`Ctrl/Cmd+P`)
2. Run **Add new custom command**
3. A form will open to fill in the command details

---

## Prompt Template Variables

Inside your prompt, you can use variables that get replaced with real content when the command runs:

| Variable | What it inserts |
|---|---|
| `{}` | The text currently selected in the editor |
| `{activeNote}` | The full content of the currently active note |
| `{[[Note Title]]}` | The content of a specific note by title |
| `{FolderPath}` | All notes within a specific folder |
| `{#tag1, #tag2}` | All notes with any of the specified tags |

> **Important**: Tags in `{#tag1, #tag2}` must be in the note's **properties (frontmatter)**, not inline tags within the note body.

**Example — quiz generator using two variables:**
```
Come up with multiple choice questions using {activeNote}, and follow
the format of {[[Quiz Template]]} to start a quiz session.

Ask one question at a time, stop and wait for the user.
After the user answers, provide the correct answer and explanation.
Repeat until the user says STOP.
```

**Example — comparison using specific notes:**
```
Compare my notes on {[[Product Roadmap]]} and {[[Competitor Analysis]]} and identify gaps.
```

**Example — acting on selected text:**
```
Rewrite this in a more formal tone: {}
```

Variable substitution must be enabled in **Settings → Copilot → Command → Enable custom prompt templating** (on by default).

---

## Using Commands

### From the Right-Click Context Menu

If a command has **Show in context menu** enabled:
1. Select some text in a note (optional)
2. Right-click to open the context menu
3. Hover over **Copilot** → select your command
4. The AI processes your selection or note and shows the result

### From the Command Palette

1. Select text or open the note you want to work with
2. Open the command palette (`Ctrl/Cmd+P`)
3. Run **Apply custom command**
4. Pick your command from the list

### As a Slash Command in Chat

Inside the chat input, type `/` followed by the command name to run it:

```
/summarize
```

The command runs in the context of your current chat session and active note.

> **Note**: The `@composer` mention (for AI note editing) requires Copilot Plus. In free modes, `@composer` will not be available.

---

## Managing Commands

Go to **Settings → Copilot → Command** to manage all your custom commands:

- **Edit** — Click the edit icon next to any command
- **Reorder** — Drag commands to change their order (affects the context menu and command list)
- **Duplicate** — Copy an existing command as a starting point
- **Delete** — Remove a command permanently
- **Sort strategy** — Choose how commands are sorted: manually, by recent use, or alphabetically

### Custom Prompts Folder

Commands are stored as markdown files in your vault. The default folder is `copilot/copilot-custom-prompts/`. You can change this in **Settings → Copilot → Basic → Custom prompts folder**.

---

## Quick Command

**Quick Command** opens a modal where you can run a one-off AI prompt on your selected text without creating a permanent command.

- **Trigger**: Command palette → **Trigger quick command**
- **Assign a hotkey**: Settings → Hotkeys → search "Trigger quick command"
- **Behavior**: Opens a prompt input, lets you choose a model and whether to include the note context, then runs the prompt on your selection

---

## Quick Ask

**Quick Ask** is a floating inline panel that appears at the cursor position in your editor. It's designed for quick, in-context AI queries while you're writing.

- **Trigger**: Command palette → **Quick Ask** (or assign a hotkey, recommended: `Ctrl/Cmd+K`)
- **Not available in Source Mode** — Works in Live Preview and Reading view
- **How it works**: A small input appears right where your cursor is. Type your question, press Enter, and the response appears inline.

Quick Ask is great for things like "rephrase this sentence," "what does this term mean?", or "suggest three alternatives."

---

## Related

- [Chat Interface](chat-interface.md) — Using slash commands in chat
- [Context and Mentions](context-and-mentions.md) — How context is passed to commands
- [Agent Mode and Tools](agent-mode-and-tools.md) — More powerful note editing with @composer
