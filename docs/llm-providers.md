# LLM Providers

Copilot V4 can get models from a Copilot license, your own provider key, or an
agent you already use. These options are separate: adding a key does not change
the models supplied by Claude Code or Codex.

## Choose a Model Source

| Model source                        | Quick Chat | Agent                                      |
| ----------------------------------- | ---------- | ------------------------------------------ |
| **Copilot-hosted models**           | Yes        | opencode                                   |
| **Your API key or endpoint (BYOK)** | Yes        | opencode, when the provider is shown there |
| **Models reported by opencode**     | No         | opencode                                   |
| **Claude Code account**             | No         | Claude                                     |
| **Codex account**                   | No         | Codex                                      |

Models reported by opencode are routed to their backing provider. Free
opencode Zen models show a warning because that provider may log or train on
prompts; review its terms before sending sensitive content.

## Copilot-Hosted Models

An eligible Copilot license can include a curated set of hosted models. You do
not need an API key from an AI provider. Enter your license under **Settings →
Copilot → Basic → Copilot License**, then click **Apply**.

Licensed models can appear in both places:

- **Basic → Agents → Quick Chat** for regular Copilot chat.
- **Basic → Agents → opencode** for Agent.

They do not appear under Claude or Codex, because those agents use their own
accounts and models. The available Copilot lineup changes over time, so use the
model lists in settings as the source of truth.

Copilot-hosted models are cloud services, not local models. Brevilabs's backend
and its vetted enterprise model providers process the full request. Copilot's
privacy policy says request content is processed transiently, not retained, and
not used for training. See the
[privacy policy](https://www.obsidiancopilot.com/en/privacy) for details.

## Bring Your Own Key (BYOK)

BYOK lets you connect Copilot directly to an AI provider, a compatible gateway,
or a model server on your computer. For cloud providers, usage and billing stay
with that provider.

1. Open **Settings → Copilot → BYOK**.
2. Click **Add a provider**.
3. Choose a provider, **Ollama**, **LM Studio**, or **Add a custom provider**.
4. Enter the **API key** and **Base URL** when required.
5. Select or enter at least one model, optionally click **Test**, then click
   **Save**.

The provider list and model catalog are loaded in the app, so this guide does
not keep a fixed provider or model count. If the endpoint cannot list its
models, you can enter a model ID yourself.

New chat models are enabled for Quick Chat and opencode by default. You can
curate each list independently:

- **Basic → Agents → Quick Chat** controls **Quick Chat models** and its
  **Default model**.
- **Basic → Agents → opencode** controls the models opencode can use and its
  **Default model**.

For enabled, routable models, Copilot passes the saved key and any custom
endpoint override to opencode when it starts. A model that opencode cannot route
is left out of the opencode list, but may still work in Quick Chat.

### Local and Custom Endpoints

Inside **BYOK → Add a provider**, choose **Ollama** or **LM Studio** from the
**Self Host** group to use their local OpenAI-compatible servers. This does not
require a Self-Host license. Their API key is optional, and Copilot fills in the
usual local URL:

- Ollama: `http://localhost:11434/v1`
- LM Studio: `http://localhost:1234/v1`

Start the local server before testing the provider. For another compatible
service or proxy, choose **Add a custom provider** and enter its base URL and
model ID. The API key is optional; add one when the endpoint requires
authentication. Model discovery uses the endpoint's `/v1/models` response, but
you can always enter an exact model ID before searching the discovered list.

If **Test** succeeds but Quick Chat cannot send a message, edit the provider
and turn on **Enable CORS**. Responses then appear after completion instead of
streaming token by token. For LM Studio, you can enable CORS in LM Studio to
keep streaming instead.

## Claude Code and Codex Accounts

Claude and Codex are Agent backends, not BYOK providers:

- **Claude** inherits authentication and models from the Claude Code CLI. Its
  usage follows your Claude Code account or CLI environment.
- **Codex** inherits authentication and models from the Codex CLI through the
  Codex ACP adapter. Its usage follows your OpenAI account or ChatGPT plan.

Copilot discovers the models reported by each agent and lets you enable them
under **Basic → Agents → Claude** or **Basic → Agents → Codex**. Those models
stay inside their respective agents; they do not become Quick Chat or opencode
models.

An OpenAI API key is different from a ChatGPT subscription, just as an
Anthropic API key is different from a Claude Code subscription. Use **BYOK** for
API access and the matching agent setup for subscription access.

## Where Keys Are Stored

Copilot stores provider API keys and the Copilot license key in this device's
**Obsidian Keychain**, not in the vault's `data.json`. The Keychain is
device-specific, so syncing a vault does not copy its credentials to another
computer.

To remove stored credentials, open **Settings → Copilot → Advanced → API Key
Storage** and click **Delete All Keys**.

## Related

- [Getting Started](getting-started.md) — Set up your first chat or agent
- [Agents in Copilot V4](agent-mode-and-tools.md) — Install opencode, Claude, or Codex
- [Models](models-and-parameters.md) — Enable models and choose defaults
- [Paid Plans and Self-Host](copilot-plus-and-self-host.md) — Licensing and included models
