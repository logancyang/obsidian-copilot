# Models, Effort, and Permissions

Copilot keeps a separate model list for each experience. A model can be
available in Copilot without appearing in every picker: you choose where it is
enabled, then choose the default for new chats.

## Where models come from

| Model source                            | Where you can use it                                              |
| --------------------------------------- | ----------------------------------------------------------------- |
| Copilot-hosted models from your license | Quick Chat and **opencode**                                       |
| Your API key or endpoint (BYOK)         | Quick Chat and **opencode**, when opencode supports that provider |
| Models reported by opencode             | **opencode** only                                                 |
| Models reported by Claude Code          | **Claude** only                                                   |
| Models reported by Codex                | **Codex** only                                                    |

The available lineups can change, so the lists in Copilot are the source of
truth. See [Model Sources and BYOK](llm-providers.md) to activate a Copilot license, add
a BYOK provider, or connect an agent account.

## Enable models and choose defaults

Open **Settings → Copilot → Basic → Agents**.

1. Set **Default backend** to the agent you want when a new Agent Chat opens.
2. Select **opencode**, **Claude**, **Codex**, or **Quick Chat**.
3. Turn on the models you want shown in that experience's model picker.
4. Choose **Default model**. For an agent, **Agent default** leaves the choice
   to that agent.
5. If the selected agent model supports it, choose **Default effort**. The
   available effort levels come from the agent and model, so they vary.

The four lists are independent:

- **opencode** can combine Copilot-hosted models, compatible BYOK models, and
  models reported by opencode.
- **Claude** and **Codex** show only models reported by their installed tools.
  Their CLI accounts own access and billing; BYOK models are not added to these
  lists.
- **Quick Chat models** contains Copilot-hosted and BYOK chat models. Agent-owned
  models do not appear here.

New BYOK chat models start enabled for both Quick Chat and opencode. You can
turn either copy off without affecting the other. Models newly reported by an
agent may also appear switched off until you enable them.

## Choose a model while chatting

In **Agent Chat**, the model picker is grouped by agent. Before the first message in
an empty session, choosing a model from another installed agent switches that
session to the other agent. After the conversation has started, the picker
stays with the current agent.

A model or effort picked beside the message box applies to that chat; it does
not replace the saved **Default model** or **Default effort**. Saved agent
defaults are used for new chats and multi-agent answers. Changes to an explicit
default apply to open chats on their next turn; choosing **Agent default**
leaves open chats unchanged.

Copilot fetches the Copilot-hosted model lineup once per plugin load. The plugin,
Claude, and Codex keep loading independently. For an eligible user, opencode's
first startup waits with a progress indicator so its model list is complete
before the local agent opens; opencode is also disabled as a cross-agent choice
during that wait. Persisted model rows are not treated as proof that a Plus
model is still available.

If the catalog cannot be reached, opencode continues with its own and BYOK
models. A saved Copilot default remains selected as **Unavailable** instead of
silently falling back, and the picker lets you choose another ready model. A
plugin reload starts one new catalog request.

In **Quick Chat**, the picker shows only enabled **Quick Chat models**. Its
**Default model** is the model new Quick Chat conversations start with.

## Model, effort, and permissions

| Experience     | Choices available now                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **opencode**   | Model; effort when the model reports it; **Default** or **Auto** permissions. **Plan** is not available.                                                                                                                                         |
| **Claude**     | Model; effort when supported; **Default**, **Plan**, and **Auto** permissions. **Auto mode permissions** controls what Auto may approve. **Show extended thinking** controls whether reasoning blocks are displayed; it is separate from effort. |
| **Codex**      | Model; effort when reported; whichever of **Default**, **Plan**, and **Auto** the installed adapter supports.                                                                                                                                    |
| **Quick Chat** | Model only. Agent effort and permission controls do not apply.                                                                                                                                                                                   |

**Default** uses the agent's normal approval behavior, **Plan** prepares a plan
before editing, and **Auto** uses the selected agent's automatic permission
behavior.

Copilot V4 does not expose temperature, top-p, or similar tuning in these model
lists. In Quick Chat, **Chat Settings** controls the session system prompt; it
does not add Agent Chat effort or permission controls.

## Related

- [Model Sources and BYOK](llm-providers.md)
- [Agent Chat](agent-mode-and-tools.md)
- [Settings: Basic](settings.md#basic)
- [Copilot Plans, Privacy, and Self-Hosting](copilot-plus-and-self-host.md)
