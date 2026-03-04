# Troubleshooting and FAQ

This guide covers common errors, provider-specific issues, performance problems, and frequently asked questions.

---

## Common Errors

### "API key not set" or "No API key configured"

**Cause**: The model you selected doesn't have a valid API key for its provider.

**Fix**:
1. Go to **Settings → Copilot → Basic → Set Keys**
2. Enter the API key for the provider your model uses
3. If you're unsure which provider a model uses, check **Settings → Copilot → Model** — each model shows its provider

### Rate Limit Errors

**Cause**: You've sent too many requests to the API in a short time.

**Fix**:
- Wait a minute and try again
- If this happens frequently during indexing, reduce **Embedding Requests per Minute** in QA settings (try 10–20)
- Consider upgrading your API plan with the provider

### Connection Errors / Timeout

**Cause**: Network issue, provider outage, or the request took too long.

**Fix**:
- Check your internet connection
- Try again after a few seconds
- Check the provider's status page for outages
- If using a local model (Ollama/LM Studio), make sure the local server is running

### "Copilot index does not exist"

**Cause**: You're trying to use Vault QA or semantic search but the vault hasn't been indexed yet.

**Fix**:
1. Make sure you have an embedding model configured with a valid API key (**Settings → Copilot → QA → Embedding Model**)
2. Run **Command palette → Index (refresh) vault**
3. Wait for indexing to complete

### "Non-markdown files are only available in Copilot Plus"

**Cause**: You tried to use a PDF, image, or other non-markdown file as context in a free mode.

**Fix**: Switch to Copilot Plus mode, or convert the file to markdown manually.

---

## Provider-Specific Issues

### Ollama

**Problem**: "Connection refused" or model not responding

**Fix**:
- Make sure Ollama is running: open a terminal and run `ollama serve`
- Verify the model is downloaded: `ollama list`
- Check that the port in Copilot settings matches (default: 11434)
- On some systems, Ollama uses `http://127.0.0.1:11434` instead of `http://localhost:11434` — try both

### Azure OpenAI

**Problem**: Authentication errors or model not found

**Fix**:
Azure OpenAI requires all four fields to be filled in correctly:
1. API Key
2. Instance Name (your Azure resource name, e.g., `my-azure-openai`)
3. Deployment Name (the name you gave your model deployment)
4. API Version (e.g., `2024-02-01`)

Any missing or incorrect field will cause errors.

### Amazon Bedrock

**Problem**: "Model not found" or access denied

**Fix**:
- Always use **cross-region inference profile IDs**, not bare model IDs:
  - ✅ `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
  - ❌ `anthropic.claude-sonnet-4-5-20250929-v1:0`
- Make sure your IAM credentials have Bedrock access permissions
- Confirm the model is available in your region

### GitHub Copilot

**Problem**: "Token expired" or authentication fails

**Fix**:
- Go to **Settings → Copilot → Basic → Set Keys**
- Click **Connect GitHub Copilot** to re-authenticate via OAuth
- Make sure your GitHub Copilot subscription is active

### Google Gemini

**Problem**: "QUOTA_EXCEEDED" or slow responses

**Fix**:
- Check your quota at https://console.cloud.google.com
- Try switching to the Flash model (faster, higher quota)
- Consider using Google via OpenRouter instead for a unified quota

### DeepSeek

**Problem**: Response cuts off or streaming errors

**Fix**:
- DeepSeek reasoning models (deepseek-reasoner) can produce very long outputs; try increasing Max Tokens
- If you see streaming errors, check the DeepSeek status page
- Try switching between deepseek-chat and deepseek-reasoner

---

## Performance Issues

### Slow Indexing

**Cause**: Large vault with many notes, or low rate limit setting.

**Fix**:
- Check **Embedding Requests per Minute** — higher values speed up indexing but may cause rate limits
- Use exclusions to skip folders you don't need indexed (e.g., large archive folders)
- Use the incremental **Index (refresh) vault** command instead of Force Reindex when possible
- Consider Miyo (self-host) for local indexing without API rate limits

### High Memory Usage

**Cause**: Large lexical search index or many indexed files.

**Fix**:
- Reduce **Lexical Search RAM Limit** in QA settings (default 100 MB, range 20–1000 MB)
- Add more folders to exclusions to reduce the index size
- On mobile, disable indexing altogether

### UI Lag

**Cause**: Rendering many chat messages or a very long conversation.

**Fix**:
- Start a new chat — long conversations can slow down rendering
- Auto-compact will trigger automatically at 128,000 tokens to keep conversations manageable
- Lower your auto-compact threshold if you're hitting performance issues early

---

## Settings Issues

### Reset Settings to Default

If your settings get into a bad state, you can reset:

1. Go to **Settings → Copilot** → find the reset option
2. Or delete the `data.json` file from the plugin folder: `.obsidian/plugins/copilot/data.json`

⚠️ Resetting will delete all your settings including API keys. Back them up first.

### API Key Encryption

Copilot can encrypt your API keys at rest for added security.

**Enable**: **Settings → Copilot → Advanced → Enable Encryption**

If you see strange authentication errors after enabling this, try disabling encryption and re-entering your keys.

### Debug Mode and Logs

For reporting bugs:

1. **Enable Debug Mode**: **Settings → Copilot → Advanced → Debug Mode**
2. **Create a log file**: **Settings → Copilot → Advanced → Create Log File**
3. The log file opens in your vault — attach it to your bug report

---

## Frequently Asked Questions

### Is my data private? Does Copilot send my notes to the cloud?

Copilot itself doesn't store your notes on any server. However, when you send a message, the content (including any context from your notes) is sent to the AI provider you've configured (OpenAI, Anthropic, etc.) via their API. Each provider has its own privacy policy. Your notes are not sent anywhere until you actively use the chat.

The memory system stores data in your vault locally. Chat history is saved as markdown files in your vault. Nothing is stored on Copilot's servers unless you use Copilot Plus cloud features.

### Can I use Copilot offline?

With local models (Ollama or LM Studio), yes — once a model is downloaded, it runs fully offline. Cloud providers (OpenAI, Anthropic, etc.) require an internet connection.

Lexical vault search works offline. Semantic search requires an embedding model, which may also need an internet connection unless you're using a local embedding provider or Miyo.

### What's the difference between Chat mode and Vault QA mode?

- **Chat** — General conversation. The AI only has access to your current note and anything you explicitly mention.
- **Vault QA** — Specifically designed for asking questions about your vault. Copilot automatically searches your notes for relevant content and includes it as context.

For most question-and-answer tasks over your vault, use **Vault QA** or **Copilot Plus** mode.

### Can I use multiple providers at the same time?

Yes. You can have API keys configured for multiple providers simultaneously and switch between models from different providers at any time. You can even set a different model for quick commands vs. regular chat.

### Where are my saved chats stored?

Chat conversations are saved as markdown files in your vault, in the folder `copilot/copilot-conversations/` by default. You can change this folder in **Settings → Copilot → Basic → Default save folder**.

### How do I clear the Copilot cache?

Use **Command palette → Clear Copilot cache**. This clears cached responses and processed files. It does not affect your chat history or the vault index.

### What is the `copilot/` folder in my vault?

The `copilot/` folder is created by the plugin and stores:
- `copilot-conversations/` — Saved chat histories
- `copilot-custom-prompts/` — Your custom commands
- `system-prompts/` — Your custom system prompts
- `memory/` — Saved AI memories (if enabled)

This folder is automatically excluded from vault search to avoid cluttering results.

### How do I switch modes?

Click the mode selector at the top of the chat panel. Available modes:
- Chat
- Vault QA (Basic)
- Copilot Plus (requires license)
- Projects (alpha)

### The AI keeps forgetting what we talked about earlier

This usually means the conversation has grown too long and older turns are being trimmed from context. Options:
- Lower **Conversation Turns in Context** in Model settings
- Let auto-compact handle it (it summarizes old turns automatically)
- Start a new chat and reference the previous chat file

---

## Getting More Help

- **GitHub Issues**: Report bugs at https://github.com/logancyang/obsidian-copilot/issues
- **Discord**: Join the Copilot Discord community for help from other users
- **Log file**: Create a log file (**Settings → Copilot → Advanced → Create Log File**) and include it in bug reports

---

## Related

- [Getting Started](getting-started.md) — First-time setup
- [LLM Providers](llm-providers.md) — Provider-specific setup details
- [Vault Search and Indexing](vault-search-and-indexing.md) — Index management
