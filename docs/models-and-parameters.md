# Models

This guide explains which chat models Copilot ships with, how to add your own,
and how to choose the one new chats start on.

---

## Chat Models

### Built-In Models

Copilot ships with a starter set of models for every provider it supports, so a
provider's models are ready to enable the moment you add its API key. Which
models those are changes with each release as providers ship new ones, so the
live list lives in the app rather than here: **Settings → Copilot → Models
(BYOK)** shows what is available for each provider you have added, and **Import
models from provider** fetches anything newer than the shipped set.

Providers covered out of the box: OpenAI, Anthropic, Google, xAI, DeepSeek,
OpenRouter, and SiliconFlow — each needs your own API key. The Copilot models
need no key of your own; see
[Models included with your license](copilot-plus-and-self-host.md#models-included-with-your-license).

### Model Capability Badges

Models may show capability badges:

- **Reasoning** — Extended internal thinking before responding; better for complex tasks
- **Vision** — Can process images (e.g., screenshots, diagrams embedded in notes)
- **Web Search** — Can access the internet directly (model-native feature)

### Managing Models

Go to **Settings → Copilot → Models (BYOK)** to add or edit providers and choose the models
available from each provider. Then go to **Settings → Copilot → Basic → Agents → Quick Chat
models** to
control which configured models appear in chat model selectors.

### Adding Custom Models

If your provider offers a model that isn't in the built-in list, you can add it manually:

1. Go to **Settings → Copilot → Models (BYOK)**
2. Add a provider or custom OpenAI-compatible endpoint
3. Enter the API key and base URL when required
4. Select or enter the models exposed by that provider
5. Save

### Importing Models from Provider

You can automatically import the full list of available models from a provider:

1. Go to **Settings → Copilot → Models (BYOK)**
2. Add or edit a provider
3. Copilot will fetch the provider's model list so you can select models to configure

## Default Model Selection

Your **default model** is the one Copilot uses when you open a new chat. Set it in:
**Settings → Copilot → Basic → Agents → Quick Chat → Default model**

The dropdown contains models enabled under **Quick Chat models**, in that same panel.

---

## Related

- [LLM Providers](llm-providers.md) — Set up API keys for your provider
- [Copilot Plus and Self-Host](copilot-plus-and-self-host.md) — The models included with a license
