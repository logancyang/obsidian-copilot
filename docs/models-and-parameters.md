# Models and Parameters

This guide explains how to manage chat models, embedding models, and the parameters that control how the AI behaves.

---

## Chat Models

### Built-In Models

Copilot comes with a set of built-in models across many providers. Some are always included ("core" models); others can be enabled or disabled.

| Model | Provider | Capabilities |
|---|---|---|
| copilot-plus-flash | Copilot Plus | Vision (Plus exclusive) |
| google/gemini-2.5-flash | OpenRouter | Vision |
| google/gemini-2.5-pro | OpenRouter | Vision |
| google/gemini-3-flash-preview | OpenRouter | Vision, Reasoning |
| google/gemini-3.1-pro-preview | OpenRouter | Vision, Reasoning |
| openai/gpt-5.2 | OpenRouter | Vision |
| openai/gpt-5-mini | OpenRouter | Vision |
| gpt-5.2 | OpenAI | Vision |
| gpt-5-mini | OpenAI | Vision |
| gpt-4.1 | OpenAI | Vision |
| gpt-4.1-mini | OpenAI | Vision |
| claude-opus-4-6 | Anthropic | Vision, Reasoning |
| claude-sonnet-4-5-20250929 | Anthropic | Vision, Reasoning |
| gemini-2.5-pro | Google | Vision |
| gemini-2.5-flash | Google | Vision |
| gemini-3-flash-preview | Google | Vision, Reasoning |
| grok-4-1-fast | XAI | Vision |
| deepseek-chat | DeepSeek | — |
| deepseek-reasoner | DeepSeek | Reasoning |

### Model Capability Badges

Models may show capability badges:

- **Reasoning** — Extended internal thinking before responding; better for complex tasks
- **Vision** — Can process images (e.g., screenshots, diagrams embedded in notes)
- **Web Search** — Can access the internet directly (model-native feature)

### Managing Models

Go to **Settings → Copilot → Model** to see the full model list.

- **Enable/disable** — Toggle individual models on or off to control what appears in the model selector
- **Reorder** — Drag models to change their order in the dropdown
- **Delete** — Remove custom models you've added

### Adding Custom Models

If your provider offers a model that isn't in the built-in list, you can add it manually:

1. Go to **Settings → Copilot → Model**
2. Click **Add Model**
3. Enter the model name exactly as the provider expects it (e.g., `gpt-4-turbo-preview`)
4. Select the provider
5. Optionally set a custom base URL (useful for proxies or alternate endpoints)
6. Save

### Importing Models from Provider

You can automatically import the full list of available models from a provider:

1. Go to **Settings → Copilot → Model**
2. Find the **Import models** button for your provider
3. Copilot will fetch the provider's model list and add new ones

---

## Embedding Models

Embedding models convert text into numerical vectors, which powers semantic (meaning-based) search in Vault QA and the "Relevant Notes" feature.

### Built-In Embedding Models

| Model | Provider |
|---|---|
| copilot-plus-small | Copilot Plus (Plus exclusive) |
| copilot-plus-large | Copilot Plus (Believer exclusive) |
| copilot-plus-multilingual | Copilot Plus (Plus exclusive) |
| openai/text-embedding-3-small | OpenRouter |
| text-embedding-3-small | OpenAI |
| text-embedding-3-large | OpenAI |
| embed-multilingual-light-v3.0 | Cohere |
| text-embedding-004 | Google |
| gemini-embedding-001 | Google |
| Qwen3-Embedding-0.6B | SiliconFlow |

### Selecting an Embedding Model

Go to **Settings → Copilot → QA** → **Embedding Model**.

If you change embedding models, you must rebuild the vault index because the old vectors are incompatible with the new model. Copilot will prompt you to confirm before rebuilding.

### What Embeddings Affect

- **Vault QA mode** — Uses embeddings to find relevant notes by meaning
- **Semantic Search** — The "Enable Semantic Search" toggle in QA settings
- **Relevant Notes** — Shows semantically similar notes in the sidebar

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
**Settings → Copilot → Basic → Default Chat Model**

The default is **OpenRouter Gemini 2.5 Flash** (requires OpenRouter API key).

---

## Related

- [LLM Providers](llm-providers.md) — Set up API keys for your provider
- [Vault Search and Indexing](vault-search-and-indexing.md) — How embedding models are used
