# Troubleshooting Copilot V4

Start in **Settings → Copilot → Basic → Agents** and check the status beside the Agent Chat backend you want to use.

## Agent Chat setup

### opencode shows “Not set up” or “Error”

1. Open **Basic → Agents → opencode**.
2. Choose **Download opencode**. If it fails, choose **Try again** and read the displayed error.
3. If opencode is already installed, choose **I already have it**. If detection misses it, open **Configure → My own binary**, enter its absolute path, and choose **Apply**.

Use **Configure → Managed by Copilot** to reinstall or uninstall it. Setup is complete at **Ready**.

### Claude shows “Update required,” cannot be found, or is signed out

- **Update required:** update Claude Code to the minimum version shown by Copilot, then run **Configure Claude → Auto-detect**. For a custom path, update that installation or choose **Clear**.
- **Not found:** run the displayed install command, then choose **Auto-detect**, or enter the absolute path to `claude`.
- **Signed out:** choose **Sign in**. If **Open sign-in page** appears, use it to finish authentication.

Copilot uses your Claude Code login; there is no API key to paste here.

### Codex is installed, but Copilot cannot find it

Copilot connects through `codex-acp`, not the `codex` executable alone.

1. Open **Basic → Agents → Codex → Configure**.
2. Run the install command shown in the dialog. It removes the conflicting `@zed-industries/codex-acp` package before installing the supported adapter. Copilot requires version 0.0.45 or newer.
3. Choose **Auto-detect**. For manual setup, enter the absolute path to `codex-acp` on macOS/Linux or `%APPDATA%\npm\node_modules\@agentclientprotocol\codex-acp\dist\index.js` on Windows, then choose **Apply**.
4. Run `codex-acp cli login` in a terminal if Codex is not authenticated.

See [Getting Started](getting-started.md) for the complete setup flow and [Windows setup for Agent Chat](agent-mode-windows-setup.md) for Windows-specific commands.

## Models, licenses, and API keys

### No models are enabled for Quick Chat

Open **Basic → Agents → Quick Chat**, enable a model, and choose a **Default model**. If none are configured, first add a provider under **Settings → Copilot → BYOK**.

- **Add API key:** edit that provider under **BYOK**.
- **Not offered by agent:** the active agent no longer advertises that saved model. Select one it currently offers.
- A locked Copilot-hosted model requires an active license under **Basic → Copilot License**. **Invalid license key** means that key was not accepted.

Claude and Codex models come from their CLI accounts; BYOK serves opencode and Quick Chat. See [Models](models-and-parameters.md) and [Providers](llm-providers.md).

### Keys disappeared, or “API Key Storage” says “Unavailable”

V4 stores secrets in the Obsidian Keychain.

- **Unavailable:** update Obsidian to 1.11.4 or newer.
- **No API keys found in this device's Obsidian Keychain:** re-enter them. Keys are per device and do not follow a synced vault.
- To remove every stored secret, use **Advanced → API Key Storage → Delete All Keys**.

Do not delete `data.json`: it contains the vault's Keychain namespace. Use the in-app reset; it does not delete Keychain entries.

## Agent Chat is waiting or behaving unexpectedly

### Nothing happens after you send

Look for **Permission required** or **Question from agent**. Review the inputs or diff, then choose an offered option. Another session tab may show an attention indicator.

Permission choices depend on the active agent. **Stop** cancels the current turn, including unanswered requests. Review every persistent permission carefully.

### You cannot switch agents in the current session

An Agent Chat keeps its original backend after work begins. Create an empty chat to choose another. Use **Recent Chats** for earlier work.

### A project message says “Waiting for context”

The message is queued while Copilot prepares saved sources. Fix or remove any source that cannot load. After changing saved context or instructions, start **New Chat**.

See [Projects](projects.md) for what is saved with a project.

### A skill or skill command is missing

In **Settings → Copilot → Skills**, confirm the skill has a valid `SKILL.md` and is enabled for your agent. Toggle the agent off and on to recreate its link.

On Windows, **Windows needs Developer Mode for multi-agent fanout** means you must enable **Settings → Privacy & security → For developers → Developer Mode** (or run Obsidian as administrator), then toggle again. The same repair works when vault sync replaces a link.

Learn more in [Skills across agents](agent-mode-and-tools.md#skills-across-agents).

## Miyo is unavailable or search is not running

Open **Settings → Copilot → Miyo**.

- **Miyo isn't running:** open Miyo, then choose **Retry** beside **Disconnect**.
- **Register this vault with Miyo:** choose **Register & connect** on the same computer. For a remote connection or mobile device, register the vault in Miyo first, then retry.
- **Chat sources are not set up:** this belongs to the separate **Search chat** row and does not block Agent Chat vault search. Configure chat sources only if you want ChatGPT or Claude history search.

Connection alone does not enable Agent Chat search. Under **Powered by Miyo**, turn on **Semantic search**. Copilot installs `miyo-search` for opencode, Claude, and Codex. If Copilot reports a same-name collision, rename or remove the existing Skill and try again.

## Quick Ask does not open or has no model

- **Quick Ask is not available in source mode:** switch the note to Live Preview and try again.
- **No active editor found:** open a Markdown note in an editor pane.
- **No active model configured:** configure and select a default under **Basic → Agents → Quick Chat**.
- **Error generating response. Please try again:** retry once; if it continues, collect a log as described below.

See [Copilot Commands and Quick Ask](custom-commands.md#quick-ask) for selection and note-context behavior.

## Logs and bug reports

For Agent Chat problems, use **Report an Issue**. Copilot prepares a screenshot and recent device-local activity logs, then opens a prefilled GitHub issue. Attach the files yourself.

For Quick Chat, enable **Advanced → Debug Mode**, reproduce the problem, then choose **Create Log File**. Agent Chat logs can also be opened or cleared in the Agent Chat debugging section under **Advanced**.

Logs and screenshots can contain prompts, note contents, paths, and tool inputs. Review them before attaching anything to a public issue.

## What works on mobile?

Agent Chat, including opencode, Claude, Codex, Projects, and Skill execution, is desktop-only. On mobile, use Quick Chat. Agent settings display **Agent settings are available on desktop.** Miyo on mobile requires a remote Miyo connection and manual vault registration in Miyo.

## Related

- [Getting Started](getting-started.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Copilot Settings](settings.md)
- [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md)
