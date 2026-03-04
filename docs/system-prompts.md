# System Prompts

A system prompt is a set of instructions you give the AI that shapes how it behaves in all conversations. Think of it as a persistent briefing: "You are an assistant that helps me with academic writing. Always cite sources. Respond in formal English."

---

## Overview

Copilot has two layers of system prompts:

1. **Built-in system prompt** — Always active. Defines core behaviors specific to Obsidian (how to format Obsidian links, how to handle note references, etc.)
2. **Custom system prompt** — Optional. You can write your own instructions that are appended to the built-in prompt.

---

## Built-In System Prompt

The built-in prompt is always active and cannot be edited. It tells the AI:

- It is "Obsidian Copilot" — an AI integrated into Obsidian
- How to format Obsidian internal links: `[[Note Title]]`
- How to format Obsidian image links: `![[image.png]]`
- How to format LaTeX math: use `$...$` not `\[...\]`
- How to handle @vault and @tool mentions
- To use `-` for bullet points (not `*`)
- To respond in the language of the user's query
- To treat "note" as referring to an Obsidian note

This prompt ensures Copilot's output is correctly formatted for Obsidian and aware of its context.

> **Warning**: Disabling the built-in prompt can break features like Vault QA, memory, and agent tools. Avoid disabling it unless you have a specific reason.

---

## Custom System Prompts

Custom system prompts let you add your own instructions on top of the built-in prompt.

### Where They're Stored

Custom system prompts are stored as markdown files in your vault, in the folder:
```
copilot/system-prompts/
```

You can change this folder in **Settings → Copilot → Advanced → System Prompts Folder Name**.

### Creating a System Prompt

#### From Settings

1. Go to **Settings → Copilot → Advanced**
2. Under **User System Prompt**, click the `+` button
3. Enter a title for the prompt (e.g., "Academic Writing")
4. A new markdown file is created in your system prompts folder
5. Open the file and write your instructions

#### From the System Prompts Folder

Create any `.md` file in the `copilot/system-prompts/` folder. Its filename (without `.md`) becomes the prompt's title.

### Writing Good System Prompts

Tips for effective system prompts:

- **Be specific**: "Always respond in bullet points with no more than 5 bullets" is better than "be concise"
- **Set a persona**: "You are an expert in cognitive science helping me build a Zettelkasten"
- **Define output format**: Specify if you want headers, lists, prose, or code blocks
- **Set language**: "Always respond in French" if you want non-English output
- **Limit scope**: "Only answer questions related to my research notes on climate science"

**Example system prompt:**
```markdown
You are a Zettelkasten assistant helping me build a knowledge base.
- Always connect new ideas to existing notes when possible
- Suggest up to 3 related concepts per response
- Format all note suggestions as [[Note Title]]
- Keep responses concise — under 200 words
```

---

## Setting a Global Default

You can set one of your custom prompts as the global default — it will be used for all new chat sessions:

1. Go to **Settings → Copilot → Advanced**
2. Under **Default System Prompt**, select your prompt from the dropdown
3. Any new conversation will start with this prompt active

To stop using a custom default, select **None (use built-in prompt)** from the dropdown.

---

## Per-Session Override (Gear Icon)

You can override the system prompt for just the current conversation:

1. Click the **gear icon** in the chat panel toolbar
2. Select a different system prompt (or type a one-off prompt directly)
3. This applies to the current session only and resets when you start a new chat

---

## How Prompts Combine

When you have a custom prompt active:

1. The built-in Copilot prompt runs first
2. Your custom prompt is appended after it

Both sets of instructions are active simultaneously. Your custom instructions can refine, restrict, or extend the default behavior, but they don't replace it.

---

## Per-Project System Prompts

Each [Project](projects.md) can have its own system prompt, independent of the global default. Configure this in the project settings under **System Prompt**.

---

## Related

- [Chat Interface](chat-interface.md) — Per-session gear settings
- [Projects](projects.md) — Per-project system prompts
- [Getting Started](getting-started.md) — Initial setup
