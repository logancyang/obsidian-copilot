# LLM Providers

Copilot supports 16+ AI providers. You can use cloud-based services that require API keys, or run models locally on your own machine. This guide explains how to set up each provider.

---

## How to Set API Keys

1. Go to **Settings → Copilot → Basic**
2. Click **Set Keys** to open the API key dialog
3. Enter your key for the provider you want to use
4. Click Save

You can configure multiple providers simultaneously and switch between them by changing the default model.

---

## Cloud Providers

### OpenRouter (Default)

OpenRouter is a gateway that provides access to hundreds of models from many providers through a single API key.

- **Get a key**: https://openrouter.ai/keys
- **Default model**: OpenRouter Gemini 2.5 Flash
- **Why use it**: One key, many models. Good starting point.
- **Setting key**: `openRouterAiApiKey`

### OpenAI

Direct access to GPT-4.1, GPT-5, and other OpenAI models.

- **Get a key**: https://platform.openai.com/api-keys
- **Models include**: GPT-5.2, GPT-5 mini, GPT-5 nano, GPT-4.1, GPT-4.1 mini, GPT-4.1 nano, o4-mini (reasoning)
- **Setting key**: `openAIApiKey`

### Anthropic

Access to Claude models (Opus, Sonnet, etc.).

- **Get a key**: https://console.anthropic.com/settings/keys
- **Models include**: claude-opus-4-6, claude-sonnet-4-5
- **Setting key**: `anthropicApiKey`

### Google Gemini

Access to Google's Gemini family of models.

- **Get a key**: https://makersuite.google.com/app/apikey
- **Models include**: gemini-2.5-pro, gemini-2.5-flash, gemini-3-flash-preview, gemini-3.1-pro-preview
- **Setting key**: `googleApiKey`

### XAI / Grok

Access to Grok models from xAI.

- **Get a key**: https://console.x.ai
- **Models include**: grok-4-1-fast
- **Setting key**: `xaiApiKey`

### Groq

Groq provides very fast inference for open-source models.

- **Get a key**: https://console.groq.com/keys
- **Models include**: llama3-8b-8192 (and others)
- **Setting key**: `groqApiKey`

### Mistral

Access to Mistral AI's models.

- **Get a key**: https://console.mistral.ai/api-keys
- **Models include**: mistral-tiny-latest (and others)
- **Setting key**: `mistralApiKey`

### DeepSeek

Access to DeepSeek's chat and reasoning models.

- **Get a key**: https://platform.deepseek.com/api-keys
- **Models include**: deepseek-chat, deepseek-reasoner
- **Setting key**: `deepseekApiKey`

### Cohere

Access to Cohere's Command models.

- **Get a key**: https://dashboard.cohere.ai/api-keys
- **Models include**: command-r
- **Setting key**: `cohereApiKey`

### SiliconFlow

A Chinese AI cloud platform with access to DeepSeek and Qwen models.

- **Get a key**: https://cloud.siliconflow.com/me/account/ak
- **Models include**: DeepSeek-V3, DeepSeek-R1 (via SiliconFlow)
- **Setting key**: `siliconflowApiKey`

### Azure OpenAI

Access to OpenAI models deployed on Microsoft Azure. Requires four fields to be configured:

| Setting | Description |
|---|---|
| API Key | Your Azure OpenAI key |
| Instance Name | Your Azure resource name |
| Deployment Name | Your model deployment name |
| API Version | e.g., `2024-02-01` |

- **Note**: Unlike other providers, Azure OpenAI uses your own Azure deployment
- **Embedding**: Can also use Azure for embeddings (separate deployment name required)

### Amazon Bedrock

Access to models hosted on AWS Bedrock.

- **Get credentials**: https://console.aws.amazon.com/iam/home#/security_credentials
- **Required fields**: Access Key ID (API key), Region
- **Setting key**: `amazonBedrockApiKey`

**Important**: Always use cross-region inference profile IDs, not bare model IDs. For example:
- Use: `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
- Not: `anthropic.claude-sonnet-4-5-20250929-v1:0`

Cross-region profiles (with the `us.`, `eu.`, `apac.`, or `global.` prefix) are more reliable and available across regions.

### GitHub Copilot

Use your existing GitHub Copilot subscription to access AI models.

- **OAuth flow**: Click **Connect GitHub Copilot** in the API key dialog
- **No separate API key needed** — authenticates via GitHub OAuth
- **Requires**: Active GitHub Copilot subscription

---

## Local Model Providers

Local providers run models on your own computer. No API key or internet connection needed once set up.

### Ollama

Runs open-source models locally on your machine.

- **Default port**: 11434
- **URL**: `http://localhost:11434/v1/`
- **Setup**: Install Ollama (ollama.ai), pull a model, then add it in Copilot's Model settings
- **No API key required**

### LM Studio

A desktop app for running local models with a GUI.

- **Default port**: 1234
- **URL**: `http://localhost:1234/v1`
- **Setup**: Install LM Studio, load a model, go to the Developer tab, **enable CORS** (required), click "Start Server", then add the model in Copilot
- **No API key required**

### 3rd Party (OpenAI-Format)

For any API that follows the OpenAI API format. Useful for custom deployments, proxies, or other local inference servers (vLLM, LiteLLM, etc.).

- **Requires**: Base URL and optionally an API key
- **Use when**: Your provider isn't in the list but speaks OpenAI-format

> **CORS Warning**: Some third-party providers (e.g., Perplexity) don't support CORS, which causes Copilot to fail with a CORS error. When adding a custom model for such a provider, enable the **CORS** toggle in the custom model form. Note: streaming is not available in CORS mode.

---

## Provider-Specific Gotchas

| Provider | Common Issue | Fix |
|---|---|---|
| Azure OpenAI | Missing one of four required fields | Check all four settings: key, instance name, deployment name, API version |
| Amazon Bedrock | Rate limit or model not found | Use cross-region inference profile IDs with `us.`, `eu.`, `apac.`, or `global.` prefix |
| GitHub Copilot | Token expired | Re-authenticate via the OAuth button in API key dialog |
| Ollama | Connection refused | Make sure Ollama is running (`ollama serve`) and the port is correct |
| Google Gemini | Quota exceeded | Use a different model or check your quota at console.cloud.google.com |
| DeepSeek | Streaming errors | Try disabling streaming in the per-session settings if you encounter issues |

---

## Related

- [Models and Parameters](models-and-parameters.md) — Enable, disable, and configure models
- [Getting Started](getting-started.md) — First-time setup
