# Models and Parameters

This guide explains how to manage chat models, embedding models, and the parameters that control how the AI behaves.

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

---

## Embedding Models

Embedding models convert text into numerical vectors, which powers semantic (meaning-based) search in Vault QA and the "Relevant Notes" feature.

### Built-In Embedding Models

| Model                         | Provider                     |
| ----------------------------- | ---------------------------- |
| copilot-plus-small            | Copilot (Plus exclusive)     |
| copilot-plus-large            | Copilot (Believer exclusive) |
| copilot-plus-multilingual     | Copilot (Plus exclusive)     |
| openai/text-embedding-3-small | OpenRouter                   |
| text-embedding-3-small        | OpenAI                       |
| text-embedding-3-large        | OpenAI                       |
| embed-multilingual-light-v3.0 | Cohere                       |
| text-embedding-004            | Google                       |
| gemini-embedding-001          | Google                       |
| Qwen3-Embedding-0.6B          | SiliconFlow                  |

### Selecting an Embedding Model

Go to **Settings → Copilot → QA** → **Embedding Model**.

If you change embedding models, you must rebuild the vault index because the old vectors are incompatible with the new model. Copilot will prompt you to confirm before rebuilding.

### What Embeddings Affect

- **Vault QA mode** — Uses embeddings to find relevant notes by meaning
- **Semantic Search** — The "Enable Semantic Search" toggle in QA settings
- **Relevant Notes** — Shows semantically similar notes in its own pane (command palette: **Open Relevant Notes**)

---

## Model Parameters

These settings control how the AI responds. Global defaults live in Settings → Copilot → Model. You can override them per-session using the gear icon in the chat panel.

### Temperature

Controls how random or creative the responses are.

- **Range**: 0.0–1.0
- **Default**: 0.1
- **Low (0.0–0.2)**: Precise, factual, deterministic
- **Medium (0.4–0.6)**: Balanced
- **High (0.8–1.0)**: Creative, varied, less predictable

### Max Tokens

Maximum number of tokens in the AI's response. A **token** is roughly ¾ of a word (so 1,000 tokens ≈ 750 words).

- **Default**: 6,000
- Higher values allow longer responses but cost more

### Conversation Turns in Context

How many past conversation turns to include in each request. More turns = more context but larger requests.

- **Default**: 15 turns
- Reduce this if you hit context limits or want to lower costs

### Auto-Compact Threshold

When the conversation reaches this many tokens, older messages are automatically summarized.

- **Default**: 128,000 tokens
- **Range**: 64,000–1,000,000 tokens
- See [Chat Interface](chat-interface.md#auto-compact) for details

### Reasoning Effort

For reasoning-capable models (like deepseek-reasoner, claude-opus-4-6), controls how much internal reasoning the model does before responding.

- **Options**: minimal, low, medium, high, xhigh
- **Default**: low
- Higher effort = better results on complex tasks, slower responses

### Verbosity

For models that support it, controls response length and detail.

- **Options**: low, medium, high
- **Default**: medium

### Top P

An alternative to temperature for controlling randomness. Leave at default unless you have a specific reason to change it.

### Frequency Penalty

Reduces the likelihood of the model repeating itself.

---

## Default Model Selection

Your **default model** is the one Copilot uses when you open a new chat. Set it in:
**Settings → Copilot → Basic → Agents → Quick Chat → Default model**

The dropdown contains models enabled under **Quick Chat models**, in that same panel.

---

## Related

- [LLM Providers](llm-providers.md) — Set up API keys for your provider
- [Vault Search and Indexing](vault-search-and-indexing.md) — How embedding models are used
