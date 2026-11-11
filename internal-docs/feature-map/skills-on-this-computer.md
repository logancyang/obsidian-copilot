# Skills on this computer

The Skills tab lists, read-only, the skills each agent loads from its own folders outside the vault, and skills linked into the vault's agent folders.

## Sub-features

- computer-list: **On this computer** lists every skill in the agents' own folders, such as `~/.claude/skills`, with its folder and the agents that use it.
- computer-shared: a skill reached from several folders shows once, listing every agent that loads any of those folders.
- computer-actions: each row's `More actions` menu offers only `Open SKILL.md` and `Show in folder`; there are no agent switches, `Properties…`, or `Delete…`.
- linked-vault-skills: a link in `.claude/skills`, `.agents/skills`, or `.opencode/skills` to a skill kept elsewhere shows in **Your skills** with the same read-only row.
- computer-unreadable: a folder Copilot cannot read leaves the section empty, and agents still start.
- computer-slash: the [chat input](chat-input.md)'s `/` menu lists these skills for the agents that use them, tagged `Computer` or `Vault`.

## How to get to it

- Settings → Copilot → Skills → On this computer.
- Settings → Copilot → Skills → Your skills, for linked vault skills.
- Type `/` in the chat input.

## Driving it

- List: add a folder with a `SKILL.md` to `~/.claude/skills`, then open the Skills tab. The skill shows under **On this computer** with `in ~/.claude/skills` and the Claude and OpenCode icons.
- Shared: link that folder into `~/.agents/skills` and return to Obsidian. The row still shows once, now with the Claude, Codex, and OpenCode icons.
- Actions: open the row's `More actions`. Only `Open SKILL.md` and `Show in folder` are listed; `Show in folder` opens the system file manager.
- Linked vault skill: link a skill folder kept elsewhere in the vault into `<vault>/.claude/skills`. It shows in **Your skills** with `in .claude/skills` and `Reveal in vault`.
- Unreadable: make an agent's skills folder unreadable and open the Skills tab. The section reads "No skills found in your agents' folders on this computer." and a new chat with that agent still starts.
- Slash menu: with Claude as the default agent, type `/` in a chat. The skill is listed with a `Computer` tag; switch to Codex and a skill only Claude loads is gone.

## Gotchas

- The list refreshes when the Skills tab opens, when Obsidian regains focus with it open, and when skills in the vault change; a skill added outside Obsidian reaches the `/` menu after one of those.
- Copilot reads these folders with each agent's environment variables from Settings → Agents, so `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `XDG_CONFIG_HOME`, or `HOME` there move the folders.
- A `/` entry whose name matches a vault skill is hidden behind the vault skill.
