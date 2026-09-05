# Copilot Settings

Open **Settings → Copilot** to configure Copilot V4. Settings normally save as soon as you change them. Controls labeled **Apply** or **Save** are the exceptions.

Copilot V4 starts with [Agent Chat](agent-mode-and-tools.md). Quick Chat remains available for lightweight conversations and as the main chat on mobile. Agent Chat, its backend settings, and Skills require desktop Obsidian.

> **Choose your data route deliberately.** Copilot-hosted models, cloud BYOK providers, Claude, Codex, remote Miyo servers, and hosted skills can receive the prompt, note excerpts, or files needed for a request. Local models and local Miyo can keep model and search traffic on your computer, but an agent or skill can still use a network service when you ask it to. See [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md#understand-service-data-routes).

The top of the settings page has two controls that apply across every tab:

| Control                       | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Version and update status** | Shows the installed Copilot version. When an update is available, the link opens Copilot's Obsidian plugin page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Reset Settings**            | Restores non-credential preferences to their defaults after confirmation. It keeps API and license keys, credential-bearing provider rows and their models, the last confirmed paid state, and the history of Copilot folders. Keyless provider rows, including local ones, and their models are reset. Backend model enablement is also reset, so you may need to enable models again under **Basic → Agents**. Reset does not delete `AGENTS.md`, saved chats, commands, skills, or data registered in Miyo. To erase credentials, use **Advanced → API Key Storage → Delete All Keys**. |

## Basic

Basic contains licensing, the main Agent Chat setup, Quick Chat model curation, general behavior, vault instructions, and conversation saving.

### Copilot License

| Control                            | Default                   | What it does                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **License key**                    | Blank on a new free setup | Paste a Copilot license key, then select **Apply** to validate it. The badge reports the current plan or **Inactive**. The key is stored in this device's Obsidian Keychain.                                                                   |
| **Copilot paid plans / See plans** | Not applicable            | Opens the paid-plan page. Paid access can add Copilot-hosted models, document processing, cloud-backed skills, and other services. Multi-agent answers require active Plus access.                                                             |
| **Miyo / pair Copilot with Miyo**  | Not applicable            | Opens [miyo.md](https://www.miyo.md/). Miyo is a separate local-first knowledge product. Remote Relay access requires a Relay or Lifetime entitlement after its trial; Supporter and eligible legacy Copilot licenses can include that access. |

A Copilot license is optional. You can use Agent Chat with opencode plus BYOK or local models, Claude with your Claude Code account, or Codex with your Codex account. Those vendors may charge separately. See [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md) for the full free and paid boundary.

### Agents

This section is desktop-only. The first selector and four inline tabs control what new Agent Chat and Quick Chat sessions can use.

| Control                            | Default                      | What it does                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default backend**                | **opencode**                 | Chooses the agent used when you select **+** for a new session and when Copilot starts a session automatically. Choosing a model from another agent in the Agent Chat model picker also changes this default. Options are **opencode**, **Claude**, and **Codex**.                                               |
| **Notification**                   | **On**                       | Plays a short sound whenever an agent stops and wants you: the turn finished, the turn hit an error, or a tool is waiting for your approval. It stays quiet while focus is inside that Agent Chat, and repeated alerts within one second play only once. Turn it off when you do not want audible notifications. |
| **Sound**                          | **Piano key**                | Chooses which sound plays: **Piano key**, **Marimba**, **Bell**, or **Doorbell**. Selecting one previews it unless another sound played in the last second. Appears only while **Notification** is on.                                                                                                           |
| **opencode / Claude / Codex tabs** | **opencode** tab opens first | Configure each installed agent, its default model and effort, its enabled models, and its process environment.                                                                                                                                                                                                   |
| **Quick Chat tab**                 | Not applicable               | Curates the separate model list used by Quick Chat and Quick Ask. Claude and Codex account models do not become Quick Chat models.                                                                                                                                                                               |

The model controls shared by installed agents behave as follows:

| Control                              | Default                                   | What it does                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default model**                    | **Agent default** until explicitly chosen | Sets the model for new chats and multi-agent answerers on that agent. An already open chat adopts a changed default on its next turn. A model disabled later remains visible as disabled until you clear or replace the default.                                          |
| **Default effort**                   | **Agent default**                         | Appears as a disabled or dynamic selector according to what the chosen model reports. Available effort names differ by agent and model.                                                                                                                                   |
| **Search models and model switches** | Dynamic                                   | Controls which reported, BYOK, or Copilot-hosted models appear in that agent's model picker. A missing-key label means the model is known but cannot run until its provider key is set.                                                                                   |
| **Environment variables**            | No rows                                   | Select **Add variable** to pass a name and value only to that agent process; use the trash button to remove a row. Names must be valid environment variable identifiers. Values are used literally, so `~` is not expanded. Do not treat this editor as a secret manager. |

#### opencode

opencode is the recommended backend and the only one Copilot can install for you. It can route Copilot-hosted models, supported BYOK providers, local OpenAI-compatible endpoints, and models reported by opencode.

When opencode is absent:

1. Select **Download opencode** to download Copilot's pinned build. Progress and **Cancel** appear in the row.
2. If you already installed it, select **I already have it** to search known locations and adopt the binary.
3. If detection fails, use **Try again** or **Configure** to enter an absolute path.

The **Configure opencode** dialog has these controls:

| Control                                      | Default                               | What it does                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Managed by Copilot**                       | Selected when no source is configured | Shows the platform, pinned version, and destination. Use **Download & install** for first setup, **Reinstall** to replace the managed copy, and **Uninstall** to remove every Copilot-downloaded opencode binary. Uninstall keeps your custom path and BYOK keys. |
| **My own binary**                            | Off                                   | Enter an absolute path, then use **Apply**, or select **Auto-detect**. **Clear** forgets the custom path. Applying a path switches the active source without deleting the managed copy.                                                                           |
| **Upgrade to latest / Run opencode upgrade** | Shown when an update is needed        | A managed source downloads the current supported build. A custom source runs opencode's own upgrade command.                                                                                                                                                      |

After installation, choose the **Default model**, **Default effort**, model switches, and optional environment variables such as `XDG_CONFIG_HOME` or `HTTPS_PROXY`. Copilot-hosted models require an eligible Copilot license. BYOK and local models do not.

#### Claude

Claude uses the Claude Code CLI and the credentials held by that CLI. It does not use Anthropic keys from the BYOK tab. If the installed CLI is too old, Copilot shows the current minimum supported version in the configuration dialog.

Select **Configure** to open these controls:

| Control                | Default                     | What it does                                                                                                                                                                                                |
| ---------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code binary** | Auto-detected when possible | Shows the resolved `claude` path. **Auto-detect** searches common install locations, **Apply** validates and saves a custom absolute path, and **Clear** removes an override and returns to auto-detection. |
| **Install it**         | Not applicable              | Shows the platform-specific Claude Code installation command. Copy and run it outside Copilot when Claude is missing or too old.                                                                            |
| **Sign in**            | Not applicable              | Shows the CLI sign-in command. When supported, the **Sign in** button runs the flow and may expose **Open sign-in page**. Copilot inherits the CLI login and never asks you to paste it into this dialog.   |

The Claude settings card also includes:

| Control                                             | Default                                   | What it does                                                                                                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Default model / Default effort / model switches** | Agent defaults; models reported by Claude | Curates Claude models for Agent Chat. Billing and limits belong to your Claude Code account.                                                                                                                              |
| **Auto mode permissions**                           | **Auto**                                  | **Auto** lets Claude judge risk and still ask about sensitive work. **Accept edits** automatically approves file edits only. **Bypass permissions** skips all checks and should be used only in a trusted vault and task. |
| **Show extended thinking**                          | Off                                       | Streams Claude's reasoning blocks in the conversation. This can increase token use.                                                                                                                                       |
| **Environment variables**                           | No rows                                   | Passes values such as `CLAUDE_CONFIG_DIR` or `HTTPS_PROXY` to Claude. These can change where Claude reads configuration and credentials.                                                                                  |

#### Codex

Codex uses the `codex-acp` adapter and the login held by the Codex CLI. It does not use an OpenAI API key from the BYOK tab.

Select **Configure** to open these controls:

| Control                                             | Default                                  | What it does                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **My own binary**                                   | Blank until detected or applied          | **Auto-detect** finds a supported `@agentclientprotocol/codex-acp`. **Apply** validates its package and version before saving its path. Copilot does not update it. |
| **Managed by Copilot**                              | Not installed                            | Downloads the exact adapter version tested with this Copilot release into Copilot's local data folder. No global npm package is changed.                            |
| **Sign in**                                         | Not applicable                           | Shows an exact-version `npx … cli login` command that works without a global adapter. The bundled Codex CLI stores that login; there is no key field here.          |
| **Default model / Default effort / model switches** | Agent defaults; models reported by Codex | Curates the models available to Codex Agent Chat. Billing and limits belong to the OpenAI or ChatGPT account used by the CLI.                                       |
| **Environment variables**                           | No rows                                  | Passes values such as `CODEX_HOME` or `OPENAI_BASE_URL` to the adapter.                                                                                             |

If a Copilot update pins a different managed adapter, the Codex row shows **Update**. Its progress, failure message, and **Retry** action are shared with the alert in Agent Chat. A custom binary remains usable and is never changed automatically.

See [Agent Chat](agent-mode-and-tools.md) for setup, permissions, projects, multi-agent answers, and normal use.

#### Quick Chat

Quick Chat uses Copilot-hosted or BYOK models, not the model currently selected in Agent Chat.

| Control                                   | Default                                                      | What it does                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Default model**                         | **Select Model** until an enabled, usable model is available | Chooses the model for new Quick Chat conversations. A licensed setup may seed a Copilot-hosted default.               |
| **Search chat models and model switches** | New BYOK chat models are enabled automatically               | Controls what appears in the Quick Chat model picker. Add or remove providers in **BYOK**, then curate the list here. |

Quick Ask uses a Quick Chat model. It inherits the Quick Chat choice until you select another model inside Quick Ask; there is no separate Quick Ask row in settings. See [Quick Chat](chat-interface.md) and [Quick Ask](custom-commands.md#quick-ask).

### General

| Control                     | Default          | What it does                                                                                                                                                                                          |
| --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open Plugin In**          | **Sidebar View** | Chooses whether Copilot opens in a sidebar leaf or an editor tab. Options are **Sidebar View** and **Editor**.                                                                                        |
| **Send Shortcut**           | **Enter**        | Chooses **Enter** or **Shift + Enter** to send. If the shortcut does not work, check **Obsidian → Hotkeys** for a conflict.                                                                           |
| **Copilot folder location** | `copilot`        | Sets the root for conversations, custom prompts, system prompts, skills, and projects. Press Enter or select **Apply** to validate and confirm the change. The folder button reveals the active root. |

Changing the Copilot folder does not move existing files. The old root remains treated as Copilot data, and a new root that already contains notes becomes excluded from Copilot search. Move files yourself after the change. Copilot applies the new root to its own search results immediately. Adjust the registered folder's scope in the Miyo app if you want Miyo and any enabled Relay clients to skip other content.

### Custom instructions

| Control                       | Default                              | What it does                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom vault instructions** | Blank `AGENTS.md`                    | Edits the root `AGENTS.md` used by every agent for vault-wide instructions. Text saves automatically after a short delay. **Open AGENTS.md** closes settings and opens the file as a note. Start a new Agent Chat after changing instructions. |
| **Saved Chat prompt notice**  | Hidden unless old prompt files exist | Points upgrading users to their old system-prompt files so useful instructions can be copied into `AGENTS.md`. It does not migrate or delete those files.                                                                                      |

See [`AGENTS.md` examples](agents-md-examples.md) and [Projects](projects.md) for project-specific instructions.

### Saving conversations

| Control                            | Default                    | What it does                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Autosave Chat as Markdown**      | On                         | Writes a Markdown conversation note after each user message and response under `<Copilot folder>/copilot-conversations/`. Turning it off skips the note. Agent Chat sessions still appear in **Recent Chats**, and Quick Chat offers **Save Chat as Note**.                                                                            |
| **Conversation Filename Template** | `{$topic}@{$date}_{$time}` | Expand the disclosure, edit the template, then select **Apply**. It controls automatic and manual conversation-note names. The template must contain `{$topic}`, `{$date}`, and `{$time}` and cannot add backslashes, slashes, colons, asterisks, question marks, quotes, angle brackets, or vertical bars outside those placeholders. |

## BYOK

Bring Your Own Key connects Copilot directly to a model provider, compatible gateway, Ollama, LM Studio, or another OpenAI-compatible endpoint. No Copilot license is required. Cloud-provider billing and data handling belong to that provider.

### Add a provider

1. Select **Add a provider**.
2. Search or choose from **Recommended** providers, **Self Host** templates for Ollama and LM Studio, the dynamic **More providers** catalog, or **Add a custom provider**.
3. Complete the configuration and select at least one model.
4. Select **Save**. New chat models are enabled for Quick Chat and opencode automatically; curate each list later under **Basic → Agents**.

The configuration dialog contains:

| Control                     | Default                                           | What it does                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Display name**            | Provider name                                     | Changes the label shown throughout Copilot.                                                                                                                                                                                                      |
| **API key**                 | Blank; required or optional according to provider | **Test** verifies the current key and refreshes model discovery. In edit mode, **Clear** stages key removal until you select **Save**. Required-key providers cannot be saved without a key. Keys are stored in this device's Obsidian Keychain. |
| **Base URL**                | Provider's standard endpoint when known           | Overrides where Copilot sends requests. A custom OpenAI-compatible provider must have a Base URL. Ollama defaults to `http://localhost:11434/v1`; LM Studio defaults to `http://localhost:1234/v1`.                                              |
| **Enable CORS**             | Off                                               | Compatibility option for Quick Chat endpoints that reject browser-style requests. When enabled, responses arrive only after completion instead of streaming token by token. It does not change opencode routing.                                 |
| **Model ID → Add**          | Blank                                             | Adds an exact model ID manually. Use this when an endpoint cannot list models. A typed ID can be removed from the candidate list with its remove button.                                                                                         |
| **Search available models** | Blank                                             | Filters discovered, previously configured, and manually added models. Check each model you want to save. Model rows can show context size, release date, and capabilities when known.                                                            |
| **Save / Cancel**           | Save disabled until the setup is usable           | Save requires at least one model, a required key when applicable, and a routable custom endpoint. A conclusive invalid-key result blocks saving; a temporary network failure does not prevent an offline setup from being saved.                 |

### Manage providers and models

| Control                     | What it does                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Search providers**        | Filters by provider name, model name, or model ID.                                                                            |
| **Provider card**           | Expand it to see configured models. The status reads **Running** for keyless local providers, **API key set**, or **No key**. |
| **More actions → Edit key** | Reopens the full configuration dialog, where you can change the name, key, Base URL, CORS behavior, and selected models.      |
| **More actions → Remove**   | Removes the provider and all of its models from every model picker after confirmation.                                        |
| **Remove model**            | The remove button on an expanded model row removes that model from the provider and all model pickers after confirmation.     |

When Self-Host Mode is on, local and self-hosted endpoints sort first. Cloud providers remain usable but receive a cloud-egress warning. See [Model Sources and BYOK](llm-providers.md) for routing details and local-server setup.

## Miyo

Miyo supplies Copilot's current semantic search and selected chat-history search through the connected Miyo service. A local search connection keeps those requests on your computer; a remote connection sends them to the address you enter. PDF and EPUB processing uses the local Miyo CLI in Agent Chat, while Quick Chat uses the connected local or remote Miyo service.

### Connection

| Control                                | Default                   | What it does                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Miyo → Connect**                     | Disconnected              | Probes local discovery or the configured remote server. A healthy connection shows **Connected · local** or **Connected · remote**. If an enabled server becomes unreachable, the pill shows **Unavailable**. Select the pill to **Disconnect** and return Copilot to non-Miyo routing. |
| **Download**                           | Not applicable            | Opens [miyo.md](https://www.miyo.md/) when Miyo is not installed.                                                                                                                                                                                                                       |
| **Connector · Relay → Set up in Miyo** | Status detected from Miyo | Opens Miyo's Connector setup. Connector can let cloud ChatGPT or Claude clients read and write registered local files. This is a separate, explicit Miyo Relay setup and privacy boundary.                                                                                              |
| **Remote Miyo server (advanced)**      | Blank                     | Expand the disclosure and enter a server URL. Blank uses local discovery. The value saves on blur and is used by both Copilot's Miyo connection and the Connector row.                                                                                                                  |

When Copilot first registers a vault, it sends its current and historical working folders and Obsidian's ignored paths as the folder's initial Miyo exclusions. Copilot does not overwrite an existing registration or later Miyo edits. It applies its current working-folder history and user-authored inclusion and exclusion rules to the Miyo results it retrieves for chat; Relevant Notes shows what Miyo returns. Manage the registered folder's server-side scope in Miyo; those rules also determine what any enabled Relay client can read.

If Miyo is reachable but the vault is not registered, the connection dialog offers **Register & connect** for a local Miyo. With a remote server or mobile setup, select **Open Miyo**, add the vault there, then **Retry**. Register only folders you intend Miyo and any enabled Relay clients to access.

### Powered by Miyo

| Control                          | Default                                    | Dependency and effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Semantic search**              | Off                                        | Desktop-only. Requires a reachable Miyo to turn on. Enabling installs the shared `miyo-search` skill; disabling removes it. The switch remains available if Miyo later goes offline. Searches are local and unlimited when Miyo is local.                                                                                                                                                                                                                                                                                                                                                                                             |
| **Search scope**                 | **Current vault**                          | Available while connected. **Current vault** restricts integrated searches to this vault. **Unrestricted** searches everything registered in that Miyo instance. Scope is a retrieval preference, not an authorization boundary.                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Search chat → Manage in Miyo** | Not set up until Miyo reports chat sources | Shows whether ChatGPT or Claude chat sources are ready or syncing, and opens Miyo to manage them. Chat search is separate from vault search.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Document Processor**           | **Plus**                                   | Controls document routes rather than one shared parser. In Agent Chat, **Miyo** runs the local `miyo-parse` CLI for PDF and EPUB and fails closed if that CLI is unavailable; a remote Miyo server is not used. Quick Chat instead asks the connected Miyo service to parse those formats, so a configured remote server processes them remotely. **Plus** can use Copilot-hosted PDF processing and paid usage. Outside the Miyo route, EPUB and ordinary non-PDF formats such as DOCX are unsupported in regular chat context; Projects use a separate conversion route. The selector remains available while Miyo is disconnected. |

See [Miyo: Local-First Search and AI Ownership](vault-search-and-indexing.md) for setup, privacy, search behavior, and troubleshooting.

## Skills

Skills are reusable instruction packets centered on a `SKILL.md` file. The Skills tab is desktop-only and does not require a Copilot license. Individual cloud-backed skills can still require paid Copilot access or another service.

Copilot discovers skills automatically from:

- `<Copilot folder>/skills/`, the shared home, which defaults to `copilot/skills/`
- `.opencode/skills/`
- `.claude/skills/`
- `.agents/skills/`

There is no separate Skills folder setting. Change the root under **Basic → General → Copilot folder location**.

If Copilot finds a `SKILL.md` that it cannot load, a warning dot appears on the Skills tab and the top of that tab shows how many skills are not available to agents. Choose **View details** to see each file's path, its specific error, and the rejected line when available. Long rejected lines stay collapsed until you choose **Show more**. **Fix with Agent** opens a fresh vault-wide Agent chat using your saved default agent and model, with the file diagnostics filled into the composer but not sent; review the request and press Enter when ready. When several skills failed, **Fix All with Agent** prepares one reviewable request for the full list. You can also choose **Open SKILL.md** to edit an indexed file in Obsidian or a hidden agent file in your default editor, while **Reveal in vault** or **Show in folder** locates it. The notice and warning dot disappear after the repaired file loads successfully; returning to Obsidian refreshes files edited externally.

### Skill list controls

| Control                                       | What it does                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Search skills**                             | Filters the visible name and description. The adjacent count reports skills that loaded successfully; files awaiting repair are listed separately above it.                                                         |
| **opencode, Claude, and Codex icon switches** | Enables or disables the skill for each agent by managing a link in that agent's native skills folder. A project-only or duplicated skill may first require migration into the shared folder.                        |
| **Edit SKILL.md**                             | Opens the shared skill in Obsidian. A skill under a hidden agent folder opens with the system's default editor.                                                                                                     |
| **Properties…**                               | Edits structured `SKILL.md` frontmatter.                                                                                                                                                                            |
| **Reveal in vault**                           | Reveals a shared skill folder in Obsidian's File Explorer. Hidden agent folders may need your system file manager.                                                                                                  |
| **Delete…**                                   | Lists every real folder and link that will be removed, then asks for confirmation. Deletion has no built-in undo; vault sync or Git is the recovery path.                                                           |
| **Migrate to shared folder**                  | Appears for identical copies spread across agent folders. It consolidates them into one shared copy and creates links for the enabled agents. Editing and deletion remain locked until the copies are consolidated. |

The **Properties** dialog contains:

| Control                                     | Default               | What it does                                                                                                                                                                            |
| ------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**                                    | Current folder name   | Renames the skill. Names are required, at most 64 characters, lowercase alphanumeric with single hyphens, and have no leading or trailing hyphen. This is the `/skill-name` users type. |
| **Description**                             | Current description   | Required summary of when the skill should be used, up to 1,024 characters.                                                                                                              |
| **Allowed tools**                           | Blank unless declared | Writes the tool allow-list used by agents that support this skill field.                                                                                                                |
| **Model override**                          | Blank                 | Claude Code only. Requests a specific Claude model for this skill.                                                                                                                      |
| **Don't let Claude invoke this on its own** | Off                   | Claude Code only. When on, Claude cannot select the skill automatically.                                                                                                                |
| **Hide from slash menu**                    | Off                   | Claude Code only. When on, the skill does not appear in Claude's slash menu.                                                                                                            |
| **Save / Cancel**                           | Not applicable        | Save validates the name and description and writes the `SKILL.md`; a name collision keeps the dialog open.                                                                              |

When a toggle needs to move or consolidate a skill, Copilot previews every move, deletion, and link it will create. **Don't ask again for future migrations** suppresses later migration confirmations. Leave it off if you want to review each filesystem change.

On Windows, creating links can require administrator access or **Settings → Privacy & security → For developers → Developer Mode**. A warning appears after a permission failure. Vaults under OneDrive, iCloud, or Dropbox can also show a sync warning because a sync client may replace links; re-toggle the agent to recreate one.

See [Skills across agents](agent-mode-and-tools.md#skills-across-agents).

## Command

Custom commands are reusable prompt files loaded from `<Copilot folder>/copilot-custom-prompts/`. The Command tab and command execution do not require a Copilot license, but the selected model or hosted service can have its own cost. Editing the Markdown files directly updates this tab.

### Command-wide controls

| Control                          | Default        | What it does                                                                                                                                                                     |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom Prompt Templating**     | On             | Resolves variables such as active note, folder, tag, and selected text. Turn it off when prompt braces should remain literal.                                                    |
| **Custom Prompts Sort Strategy** | **Recency**    | **Recency** sorts by last use, **Alphabetical** sorts by name, and **Manual** uses the saved drag order.                                                                         |
| **Generate Default**             | Not applicable | After confirmation, adds Copilot's starter command files to the custom-prompts folder. It does not replace the folder setting because that folder derives from the Copilot root. |
| **Add Cmd**                      | Not applicable | Opens the command editor with a blank command.                                                                                                                                   |

### Command list and editor

| Control                  | Default                     | What it does                                                                                                               |
| ------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Drag handle**          | Saved order                 | Reorders commands. Choose **Manual** if you want drag order to control the slash menu.                                     |
| **In Menu**              | On for a new command        | Shows the command in the editor right-click menu.                                                                          |
| **Slash Cmd**            | On for a new command        | Shows the command after `/` in Quick Chat and Agent Chat. Sending resolves the command name to its saved prompt.           |
| **Edit**                 | Not applicable              | Opens the command editor.                                                                                                  |
| **Duplicate**            | Not applicable              | Creates a uniquely named copy beside the original.                                                                         |
| **Delete**               | Not applicable              | Permanently removes the command's Markdown file after confirmation.                                                        |
| **Name**                 | Blank for a new command     | Required unique command name.                                                                                              |
| **Prompt**               | Blank for a new command     | Required prompt body. With templating on, the syntax helper shows the supported note variables.                            |
| **Model (Optional)**     | **Inherit from chat model** | Selects a Quick Chat model for editor and command-palette runs. An Agent Chat slash run uses the current Agent Chat model. |
| **Show in context menu** | On                          | Same setting as **In Menu** in the list.                                                                                   |
| **Show in slash menu**   | On                          | Same setting as **Slash Cmd** in the list.                                                                                 |
| **Save / Cancel**        | Not applicable              | Save validates and writes the command file.                                                                                |

See [Copilot Commands and Quick Ask](custom-commands.md) for prompt variables, invocation, and Quick Ask.

## Self-Host

Self-Host Mode is an optional presentation and routing aid for licenses whose signed entitlement includes Self-Host. The tab labels it a **Lifetime license** feature for Believer and Supporter access. A local BYOK model and local Miyo do not require this entitlement.

> **Self-Host Mode is not a firewall.** It flags and sorts cloud options but does not disable them. Claude, Codex, Copilot-hosted models, cloud BYOK providers, Firecrawl, Perplexity, Parallel, Exa, and Supadata can still send data off-device when selected.

| Control                   | Default        | Dependency and effect                                                                                                                                                                                                                                             |
| ------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enable Self-Host Mode** | Off            | Can turn on only when the current signed entitlement grants Self-Host. Turning it off is always allowed. While on, local options sort first and cloud agents, providers, and models receive warnings. The entitlement can remain usable offline until it expires. |
| **Web Search Provider**   | **Firecrawl**  | Enabled only while Self-Host Mode is on. Chooses **Firecrawl**, **Perplexity Sonar**, **Parallel**, or **Exa** as the web-search skill provider.                                                                                                                  |
| **Firecrawl API Key**     | Blank          | Appears when Firecrawl is selected. Enables Firecrawl web search and fetch. Firecrawl is a separate third-party service.                                                                                                                                          |
| **Perplexity API Key**    | Blank          | Appears when Perplexity Sonar is selected. Enables Perplexity web search. Perplexity is a separate third-party service.                                                                                                                                           |
| **Parallel API Key**      | Blank          | Appears when Parallel is selected. Enables Parallel web search. Parallel is a separate third-party service.                                                                                                                                                       |
| **Exa API Key**           | Blank          | Appears when Exa is selected. Enables Exa web search. Exa is a separate third-party service.                                                                                                                                                                      |
| **Supadata API Key**      | Blank          | Enables YouTube transcript retrieval through Supadata, a separate third-party service.                                                                                                                                                                            |
| **Open BYOK**             | Not applicable | Opens the BYOK tab, where you add local or self-hosted OpenAI-compatible endpoints. It does not choose or install a model automatically.                                                                                                                          |

All controls below the main switch are disabled while Self-Host Mode is off. See [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md#self-host-mode-is-a-guide-not-a-firewall) for routes and limitations.

## Advanced

Advanced contains credential storage and diagnostic controls.

### Others

| Control             | Default                                           | What it does                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API Key Storage** | **Obsidian Keychain** on Obsidian 1.11.4 or newer | Reports whether secure storage is available and whether this device appears to have keys. Each device has a separate Keychain, so vault sync does not copy credentials. Older Obsidian builds cannot load, save, or delete Keychain entries.                      |
| **Delete All Keys** | Not applicable                                    | After confirmation, removes Copilot API and license keys from the Obsidian Keychain, `data.json`, and in-memory settings. You must enter them again. Credential backup files created during a V4 upgrade are left in place for you to review and delete manually. |
| **Debug Mode**      | Off                                               | Logs Quick Chat activity to **View → Toggle Developer Tools**. It does not control the separate Agent Chat activity log below.                                                                                                                                    |
| **Create Log File** | Not applicable                                    | Flushes, saves, and opens the regular Quick Chat log for troubleshooting. Review it before sharing because diagnostic data can contain conversation content.                                                                                                      |

### Agent Chat debugging

These controls are separate from Quick Chat logging.

| Control                                  | Default        | What it does                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Report an Issue**                      | Not applicable | Desktop-only. Asks what went wrong, then prepares a local folder containing an Agent Chat pane screenshot and recent activity log and opens a prefilled GitHub issue. For opencode, including its global backend log is an extra checkbox that is off by default. Files are not attached automatically; review and redact them before dragging them into the public issue. |
| **Keep an Agent Chat activity log**      | On             | Records messages between Copilot and the agent so a recent trace exists when a problem occurs. The plain-text log is device-local and outside the vault, but it can contain prompts, note contents, and tool inputs or outputs. Turn it off to stop future logging.                                                                                                        |
| **Agent Chat activity log file → Open**  | Not applicable | Desktop-only. Opens the current log on disk so you can inspect it.                                                                                                                                                                                                                                                                                                         |
| **Agent Chat activity log file → Clear** | Not applicable | Desktop-only. Clears the local activity log.                                                                                                                                                                                                                                                                                                                               |

See [Troubleshooting and FAQ](troubleshooting-and-faq.md) before sharing logs or filing an issue.
