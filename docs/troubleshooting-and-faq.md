# Troubleshooting Copilot V4

Start in **Settings → Copilot → Basic → Agents** and check the status beside the agent you want to use.

## Agent setup

### opencode shows “Not set up” or “Error”

1. Open **Basic → Agents → opencode**.
2. Choose **Download opencode**. If it fails, choose **Try again** and read the displayed error.
3. If opencode is already installed, choose **I already have it**. If detection misses it, open **Configure → My own binary**, enter its absolute path, and choose **Apply**.

Use **Configure → Managed by Copilot** to reinstall or uninstall it. Setup is complete at **Ready**.

### Claude shows “Update required,” cannot be found, or is signed out

Copilot requires Claude Code 2.1.206 or newer.

- **Update required:** update Claude Code, then run **Configure Claude → Auto-detect**. For a custom path, update that installation or choose **Clear**.
- **Not found:** run the displayed install command, then choose **Auto-detect**, or enter the absolute path to `claude`.
- **Signed out:** choose **Sign in**. If **Open sign-in page** appears, use it to finish authentication.

Copilot uses your Claude Code login; there is no API key to paste here.

### Codex is installed, but Copilot cannot find it

Copilot connects through `codex-acp`, not the `codex` executable alone.

1. Open **Basic → Agents → Codex → Configure**.
2. Run the displayed install command. On macOS and Linux: `npm install -g @agentclientprotocol/codex-acp`.
3. Choose **Auto-detect**, or enter the absolute path to `codex-acp` and choose **Apply**.
4. Run `codex login` in a terminal if Codex is not authenticated.

See [Getting Started](getting-started.md) for the complete setup flow and [Windows Setup for Agent](agent-mode-windows-setup.md) for Windows-specific commands.

## Models, licenses, and API keys

### The picker says “No models — enable in Basic → Agents → Quick Chat”

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

## Agent chat is waiting or behaving unexpectedly

### Nothing happens after you send

Look for **Permission required** or **Question from agent**. Review the inputs or diff, then choose an offered option. Another session tab may show an attention indicator.

Permission choices depend on the active agent. **Stop** cancels the current turn, including unanswered requests. Review every persistent permission carefully.

### You cannot switch agents in the current session

An Agent session keeps its original backend after work begins. Create an empty session to choose another. Use **Recent Chats** for earlier sessions.

### A project message says “Waiting for context”

The message is queued while Copilot prepares saved sources. Fix or remove any source that cannot load. After changing saved context or instructions, start **New Chat**.

See [Agent Projects](projects.md) for what is saved with a project.

### A skill or skill command is missing

In **Settings → Copilot → Skills**, confirm the skill has a valid `SKILL.md` and is enabled for your agent. Toggle the agent off and on to recreate its link.

On Windows, **Windows needs Developer Mode for multi-agent fanout** means you must enable **Settings → Privacy & security → For developers → Developer Mode** (or run Obsidian as administrator), then toggle again. The same repair works when vault sync replaces a link.

Learn more in [Agents in Copilot V4](agent-mode-and-tools.md#skills-shared-across-agents).

## Miyo is unavailable or search is not running

Open **Settings → Copilot → Miyo**.

- **Miyo isn't running:** open Miyo, then choose **Retry connection**.
- **Register this vault with Miyo:** choose **Register & connect** on the same computer. For a remote connection or mobile device, register the vault in Miyo first, then retry.
- **Not set up — add chat sources in Miyo:** this belongs to the separate **Search chat** row and does not block Agent vault search. Configure chat sources only if you want ChatGPT or Claude history search.
- If excluded folders no longer match the Copilot folder, choose **Resync Miyo**. For a remote connection, remove and re-add the vault in Miyo.

Connection alone does not enable Agent search. Under **Powered by Miyo**, turn on **Semantic search**. Copilot installs `miyo-search` already enabled for opencode, Claude, and Codex. If Copilot reports a same-name collision, rename or remove the existing skill and try again.

## Quick Ask does not open or has no model

- **Quick Ask is not available in source mode:** switch the note to Live Preview and try again.
- **No active editor found:** open a Markdown note in an editor pane.
- **No active model configured:** configure and select a default under **Basic → Agents → Quick Chat**.
- **Error generating response. Please try again:** retry once; if it continues, collect a log as described below.

See [Copilot Commands and Quick Ask](custom-commands.md#quick-ask) for selection and note-context behavior.

## Logs and bug reports

For Agent problems, use **Report an Issue**. Copilot prepares a screenshot and recent device-local activity logs, then opens a prefilled GitHub issue. Attach the files yourself.

For Quick Chat, enable **Advanced → Debug Mode**, reproduce the problem, then choose **Create Log File**. Agent logs can also be opened or cleared under **Advanced → Agent Mode activity log file**.

Logs and screenshots can contain prompts, note contents, paths, and tool inputs. Review them before attaching anything to a public issue.

## What works on mobile?

Agent—including opencode, Claude, Codex, Agent projects, and agent skill execution—is desktop-only. On mobile, use Quick Chat. Agent settings display **Agent settings are available on desktop.** Miyo on mobile requires a remote Miyo connection and manual vault registration in Miyo.

## Related

- [Getting Started](getting-started.md)
- [Agents in Copilot V4](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md)
