# Instructions for Agent Chat and Quick Chat

Instructions are rules Copilot should keep following, such as your writing style, folder conventions, preferred formats, and safety boundaries.

Agent Chat and Quick Chat use different instruction systems:

- **Agent Chat** reads `AGENTS.md` files that are shared across opencode, Claude, and Codex.
- **Quick Chat** uses selectable system prompt files.

Changing one does not change the other.

## Choose the right instruction tool

| Use                          | Best for                                                      |
| ---------------------------- | ------------------------------------------------------------- |
| Vault `AGENTS.md`            | Rules every Agent Chat in a vault should follow               |
| Project `AGENTS.md`          | More specific rules for one Project                           |
| **Skill**                    | A reusable workflow with instructions and supporting files    |
| **Copilot command**          | A short saved prompt or template you want to run again        |
| **Quick Chat system prompt** | A role, tone, or response style for a Quick Chat conversation |
| One-off prompt               | A request that matters only for the current turn              |

Keep stable conventions in `AGENTS.md`. Use a [Skill](agent-mode-and-tools.md#skills-across-agents) when an agent needs a repeatable process. Use a [Copilot command](custom-commands.md) for a short reusable prompt.

## Vault instructions for Agent Chat

Vault-wide instructions live in `AGENTS.md` at the root of your vault. They apply to new Agent Chats with opencode, Claude, and Codex.

Open [**Settings → Copilot → Basic → Custom instructions**](settings.md#basic) and edit **Custom vault instructions**. Copilot saves the text to the vault-root file as you type. Select **Open AGENTS.md** to edit the same file as a normal note.

Good instructions are short and concrete:

```markdown
- Keep meeting notes under Meetings/.
- Use YYYY-MM-DD dates.
- Preserve existing frontmatter unless I ask you to change it.
- Ask before deleting a note.
```

Start a new Agent Chat after changing `AGENTS.md` so the selected backend reads the latest version.

## Project instructions

Each [Project](projects.md) can add its own `AGENTS.md` inside the Project folder. Open the Project info menu and select **AGENTS.md**, or use **Edit project → Project instructions**.

A Project chat follows both files:

1. The vault-root `AGENTS.md` provides general rules.
2. The Project `AGENTS.md` provides more specific rules and takes precedence when the two conflict.

Use Project instructions for details that should not affect the rest of the vault, such as a client's tone, deliverable format, source folders, or output location.

## Claude compatibility

Claude Code normally reads `CLAUDE.md`. To keep `AGENTS.md` as the shared source of truth, Copilot adds this import to the related `CLAUDE.md`:

```markdown
@AGENTS.md
```

If `CLAUDE.md` already contains Claude-specific instructions, Copilot preserves them and adds the import. You do not need to copy shared rules into both files.

## System prompts for Quick Chat

Quick Chat system prompts are Markdown files under:

```text
<Copilot folder>/system-prompts/
```

Create a `.md` file in that folder. The filename becomes the prompt name, and the file body contains the instructions. Copilot refreshes the prompt list when you create, edit, rename, or delete a file.

In Quick Chat, open **Chat Settings** and choose a **System Prompt**. Select **None (use built-in prompt)** to return to Copilot's default.

The selected system prompt applies only to Quick Chat. For a bound-Agent model, Copilot includes it in the text prompt sent through that Agent's CLI binding; it does not configure the Agent Chat session. Agent Chat reads `AGENTS.md` instead.

## Examples and next steps

Start with the [`AGENTS.md` examples](agents-md-examples.md), then keep only rules that reflect how you actually work. Long procedures are easier to maintain as [Skills](agent-mode-and-tools.md#skills-across-agents).

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Copilot Commands and Quick Ask](custom-commands.md)
- [Quick Chat](chat-interface.md)
