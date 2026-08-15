# `AGENTS.md` Examples for Copilot V4

`AGENTS.md` holds instructions that Agent should keep following. Write shared vault rules once at the vault root; Copilot makes them available to **opencode**, **Claude**, and **Codex**. An Agent project can add a second `AGENTS.md` in its project folder, and those more specific rules win when the two files conflict.

Start small. A useful file describes how _your_ vault works, not everything an AI might ever need to know.

## Starter `AGENTS.md` for an Obsidian vault

Copy this to the root of your vault, then change it to match your habits:

```markdown
# Vault instructions

## Working style

- Lead with the result, then explain only what helps me act on it.
- If a request is ambiguous in a way that changes the outcome, ask before proceeding.
- Use available skills for repeatable workflows instead of improvising the process.

## Notes

- Treat this vault as a knowledge base, not a software repository.
- Read a note before making claims about its contents.
- Preserve existing frontmatter, wikilinks, embeds, and formatting unless I ask for changes.
- Use `[[Note Title]]` for links between notes.
- Make the smallest change that completes the request.

## Safety and completion

- Ask before deleting notes, moving many files, or publishing anything outside the vault.
- Never place passwords, API keys, or private note content in external services without permission.
- When finished, name the notes you changed and mention anything you could not verify.
```

Start a new Agent chat after editing `AGENTS.md` so every backend reads the latest version.

## Patterns worth adding

Add only patterns that describe real, recurring preferences:

- **Organization:** where meeting notes, sources, drafts, and finished work belong.
- **Naming:** date formats, title conventions, tags, and required properties.
- **Evidence:** when the agent must read source notes, search the vault, or verify current facts.
- **Boundaries:** which edits are routine and which actions require confirmation.
- **Definition of done:** checks to run and what the final handoff should report.
- **Routing:** which repeatable jobs belong to a [Skill](agent-mode-and-tools.md#skills-shared-across-agents).

For a project, keep the override short. For example:

```markdown
# Project instructions

- Write deliverables to `outputs/`.
- Use a concise, client-ready tone.
- Cite the project sources used for factual claims.
- Do not modify source notes unless I ask.
```

## External examples worth studying

- [Andrej Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — borrow its separation of raw sources, maintained knowledge, and update rules.
- [GBrain `AGENTS.md`](https://raw.githubusercontent.com/garrytan/gbrain/master/AGENTS.md) — study its read order, privacy boundary, and explicit user decisions.
- [gstack `AGENTS.md`](https://raw.githubusercontent.com/garrytan/gstack/main/AGENTS.md) — notice how the file routes substantial workflows into skills instead of containing every procedure.
- [`claude-obsidian` `AGENTS.md`](https://github.com/AgriciDaniel/claude-obsidian/blob/main/AGENTS.md) — a concrete example of conventions for an AI-maintained Obsidian knowledge base.
- [Daniel Mulroy's Pi workspace](https://raw.githubusercontent.com/dmmulroy/.dotfiles/main/home/.pi/AGENTS.md) — borrow its compact map of where to look, what to avoid, and how to handle sensitive information.

## What not to copy blindly

- Another person's folder paths, tool names, account identity, or publishing workflow.
- Broad permission or deletion rules you would not want applied to your own vault.
- Long step-by-step procedures that should be a skill.
- Coding, test, and release rules when the scope is ordinary note work.
- Secrets or private information. Agents can read `AGENTS.md`; treat it as normal vault content.

Review the file occasionally. Keep rules that prevent a recurring mistake or express a real preference, and remove generic advice that does not change the agent's behavior.

## Related

- [Instructions in Copilot V4](system-prompts.md)
- [Agents in Copilot V4](agent-mode-and-tools.md)
- [Projects](projects.md)
