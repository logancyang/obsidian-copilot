# Agent setup

Choosing and installing an agent, signing in, and its defaults: the `Select your agent` panel in Agent Chat and the Agents section of Copilot settings.

## Sub-features

- setup-select: when the default agent cannot start and no chat is open, Agent Chat shows `Select your agent`: each agent with a line on what it runs, a `Recommended` or status badge such as `Installed`, `Update required`, or `Sign in required`, then `Start chat` or `Configure`.
- setup-status: each agent's tab in Settings shows its status, such as `Ready`, the path it runs from, which service it sends requests to, and `Configure`.
- setup-configure: `Configure <agent>` sets up the installation. OpenCode and Codex offer `Managed by Copilot` (`Download & install`, `Update`, `Reinstall & use managed`, `Uninstall`) or `My own installation` (`Auto-detect`, `Apply`); Claude offers `Auto-detect` and the `Install Claude Code` command.
- setup-sign-in: under Authentication, `Sign in with your browser` or `Sign in using a terminal instead`; once signed in, `Signed in as <account>` and `Sign out`.
- setup-default-agent: Settings `Default agent` picks the agent new chats start with; picking another agent's model in a chat, or `Start chat` in `Select your agent`, also changes it.
- setup-default-model: each agent's `Default model` and `Default effort`.
- setup-models: each agent's model list switches models on or off, with `Search <agent> models…`; only switched-on models show in `Default model` and in the chat's model picker.
- setup-agent-options: per-agent options, such as Claude's `Auto mode permissions` (`Auto`, `Accept edits`, `Bypass permissions`) and `Show extended thinking`, and each agent's `Environment variables` with `Add variable`.
- setup-approved-rules: Claude's, OpenCode's, and Codex's tabs end with `Approved rules` and `Edit approved rules`, which replaces the Copilot settings view with a page listing each saved rule, with `Search approved rules…`, `Remove` per rule, and `Back`. Claude's rules come from `Allow always` and show "Saved in <file>"; OpenCode's come from `Always allow`, read as `shell: echo *`, and show "Chats in <folder>". Codex's come from `Yes, and don't ask again for commands that start with…`, read as `touch codex-probe.txt` or `Network access to api.github.com (https)`, and show "Saved in <Codex home>/rules/default.rules".
- setup-notification: `Notification` plays a `Sound` (Piano key, Marimba, Bell, Doorbell) when an agent finishes a turn.

## How to get to it

- Settings → Copilot → Basic → Agents: `Default agent` and `Notification`, then a tab per agent (OpenCode, Claude, Codex) with its status, `Configure`, defaults, models, and options. Claude's, OpenCode's, and Codex's tabs also offer `Edit approved rules`.
- Agent Chat shows `Select your agent` when the default agent cannot start and no chat is open.
- `Install <agent>`, `Configure <agent>`, `Update`, and `Sign in` on a [status card](status-and-error-cards.md).

## Driving it

- Select: set `Default agent` to an agent that is not set up and close every chat tab. Agent Chat shows `Select your agent` with OpenCode (`Recommended`), Claude (`Installed`), and Codex. With the agent that is not set up picked, it reads "<agent> isn't set up on this machine yet." and offers `Configure`.
- Start: pick Claude and choose `Start chat`. A new chat opens on Claude, and `Default agent` in Settings reads Claude.
- Status: open Settings → Claude. It shows `Ready`, the path to `claude`, "Sends requests to: Anthropic", and `Configure`.
- Configure, managed agent: in `Select your agent`, pick Codex and choose `Configure`. `Configure Codex` shows its status, `Managed by Copilot` with Platform, Version, Location, and its install action. `My own installation` shows `Auto-detect` and `Apply`. `Done` closes it.
- Configure, Claude: in Settings → Claude, choose `Configure`. `Configure Claude` shows `Auto-detect`, `Install Claude Code` with its npm command, and Authentication.
- Sign in: in `Configure Claude`, Authentication reads `Signed in` and "Signed in as <account> (<plan>)." with `Sign out`. Signed out, it offers `Sign in with your browser` and `Sign in using a terminal instead`.
- Default model and effort: in Settings → Claude, set `Default model` to Sonnet 5.5 and `Default effort` to low, then choose `New chat`. The chat's `Model · effort` reads `Sonnet 5.5 · low`.
- Models: switch on Haiku 5.5 in Claude's model list. `Default model` and the chat's `Model · effort` now list Haiku 5.5.
- Options: in Settings → Claude, `Auto mode permissions` lists `Auto`, `Accept edits`, and `Bypass permissions`. Under `Environment variables`, `Add variable` adds a name and value row.
- Approved rules: in a `Safe` chat, ask Claude to run `curl -sI https://example.org` and choose `Allow always` on the [permission request](permission-requests.md). In Settings → Claude, choose `Edit approved rules`. The page lists `Bash(curl -sI https://example.org)` "Saved in <vault>/.claude/settings.local.json". Choose `Remove`: the row goes away, and asking again in a new chat shows `Permission required`. `Back` returns to Claude's settings.
- OpenCode approved rules: in a `Safe` OpenCode chat, ask it to run `echo hello` and choose `Always allow`. In Settings → OpenCode, choose `Edit approved rules`. The page lists `shell: echo *` "Chats in <vault>". Choose `Remove`: the row goes away, and asking again, in the same chat or a new one, shows `Permission required`.
- Codex approved rules: in a `Safe` Codex chat, ask it to run `touch codex-probe.txt` and choose `Yes, and don't ask again for commands that start with…`. In Settings → Codex, choose `Edit approved rules`. The page lists `touch codex-probe.txt` "Saved in <Codex home>/rules/default.rules". Choose `Remove`: the row goes away, the line leaves the file, and asking again in a new chat shows `Permission required`.
- Notification: turn on `Notification`. A `Sound` choice appears with Piano key, Marimba, Bell, and Doorbell; picking one plays it.

## Gotchas

- `Default model` and `Default effort` also change chats that are already open, on their next turn.
- An agent's installation and its `Environment variables` are kept per computer. The same vault on another computer shows the agent as not set up until it is set up there.
- Removing an approved rule also reaches a Claude chat that is already open: its next request for that action asks again. If that rule's `Allow always` tooltip also listed "all file edits", the open chat keeps accepting file edits, so a command such as `touch` still runs there without asking.
- `Edit approved rules` lists only rules saved in Claude's config folder and the vault folder. Rules saved for a project chat live in the project note's folder and do not show.
- OpenCode's `Edit approved rules` lists only the vault folder's OpenCode rules; rules saved by project chats belong to the project note's folder and do not show. Removing one also reaches an OpenCode chat that is already open.
- Codex's `Edit approved rules` lists only the one-line grants Codex writes to `rules/default.rules`; comments, multi-line rules, other decisions, and other `*.rules` files stay in place and do not show. A Codex chat that is already open keeps a removed rule until a new chat starts.
- A managed agent is installed once per computer and shared by every vault. `Uninstall` removes it for all of them.
