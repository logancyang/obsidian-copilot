# Instructions in Copilot V4

Instructions are rules Copilot should keep following: your writing style, where files belong, preferred formats, or project conventions.

Agent and Quick Chat use different instruction systems:

- **Agent** uses `AGENTS.md`, shared across **opencode**, **Claude**, and **Codex**.
- **Quick Chat** uses selectable system prompt files.

## Choose the right tool

| Use                          | Best for                                                            |
| ---------------------------- | ------------------------------------------------------------------- |
| `AGENTS.md`                  | Rules an agent should follow throughout a vault or project          |
| **Skill**                    | A reusable workflow with instructions, scripts, or supporting files |
| **Copilot command**          | A short saved prompt or template you want to run again              |
| **Quick Chat system prompt** | A role or response style for one Quick Chat conversation            |
| One-off prompt               | A request that matters only for the current turn                    |

Keep stable conventions in `AGENTS.md`. Use a [Skill](agent-mode-and-tools.md#skills-shared-across-agents) when the agent needs a repeatable process, and a [Copilot command](custom-commands.md) for a short reusable prompt.

## Vault instructions for Agent

Vault-wide instructions live in `AGENTS.md` at the root of your vault. They apply to Agent chats with opencode, Claude, and Codex.

Open **Settings → Copilot → Basic → Custom instructions** and edit **Custom vault instructions**. Copilot saves the text to the file as you type. Select **Open AGENTS.md** to edit the same content as a normal note.

Good vault instructions are short and concrete. For example:

```markdown
- Keep meeting notes under Meetings/.
- Use YYYY-MM-DD dates.
- Preserve existing frontmatter unless I ask you to change it.
- Ask before deleting a note.
```

Start a new Agent chat after changing instructions so every backend reads the latest version.

## Project instructions

Each Agent project can have its own `AGENTS.md` inside the project folder. In **Edit Project**, use **Project instructions**, or open the project's `AGENTS.md` from its info panel.

A project chat follows both files:

1. Vault `AGENTS.md` provides the general rules.
2. Project `AGENTS.md` adds more specific rules and wins if the two conflict.

Use project instructions for details that should not affect the rest of the vault, such as a client's tone, deliverable format, or output folder. See [Projects](projects.md).

## Claude compatibility

Claude normally reads `CLAUDE.md`. To keep one shared source of truth, Copilot adds this import beside each managed `AGENTS.md`:

```markdown
@AGENTS.md
```

If `CLAUDE.md` already contains your own Claude-specific instructions, Copilot preserves them and adds the import. You do not need to copy shared rules into both files.

## System prompts for Quick Chat

Quick Chat system prompts are Markdown files in:

```text
<Copilot folder>/system-prompts/
```

Create a `.md` file directly in that folder. Its filename becomes the prompt name, and its body contains the instructions. Copilot updates the prompt list when you create, edit, rename, or delete a file.

In Quick Chat, open **Chat Settings** (gear) and choose a **System Prompt**. The picker also includes **None (use built-in prompt)**. Your custom prompt selection applies to Quick Chat, not Agent; Agent reads `AGENTS.md` instead.

## Related

- [Agents in Copilot V4](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Copilot Commands and Quick Ask](custom-commands.md)
- [Quick Chat](chat-interface.md)
