# Copilot Plus and Self-Host

**Copilot Plus** is a premium tier that unlocks advanced features beyond the free, API-key-based experience. **Self-Host Mode** is an additional option for Copilot Plus Lifetime/Believer subscribers who want to run their own infrastructure.

---

## Copilot Plus

### What Is Copilot Plus?

Copilot Plus is a subscription that enables:

- **Autonomous agent mode** — AI that reasons step-by-step and uses tools automatically
- **File editing tools** — Write to File and Replace in File for AI-driven note editing
- **Web search** — Search the internet from chat
- **YouTube transcription** — Fetch video transcripts and use them as context
- **Memory system** — Persistent memory across conversations
- **Copilot Plus Flash model** — A built-in model that requires no separate API key
- **URL processing** — Fetch and summarize web pages as context
- **Copilot Plus embedding models** — High-quality embeddings for semantic search

### Setting Up Copilot Plus

1. Get a license key from the Copilot Plus page
2. Go to **Settings → Copilot → Basic** (or the Plus banner in the settings)
3. Enter your license key in the **Copilot Plus License Key** field
4. Features unlock automatically

---

## Copilot Plus Flash Model

**Copilot Plus Flash** is a built-in AI model included with your Copilot Plus subscription:

- No separate API key needed
- Works out of the box once your license key is active
- Supports vision (image inputs)
- Good for general-purpose tasks

It appears as `copilot-plus-flash` in the model selector.

---

## Memory System

The memory system lets Copilot remember things across conversations, so you don't have to repeat yourself.

### Recent Conversations

Copilot can reference your recent conversation history to provide more contextually relevant responses. This is separate from the current chat window — it's a summary of what you've been working on.

- **Enable**: **Settings → Copilot → Plus → Reference Recent Conversation** (on by default)
- **How many**: **Settings → Copilot → Plus → Max Recent Conversations** — default 30, range 10–50
- All history is stored locally in your vault (no data leaves your machine for this feature)

### Saved Memories

You can ask Copilot to explicitly remember specific facts about you:

```
@memory remember that I'm preparing for JLPT N3 and prefer bullet-point summaries
```

Copilot saves this to a memory file in your vault and references it in future conversations.

- **Enable**: **Settings → Copilot → Plus → Reference Saved Memories** (on by default)
- **Memory folder**: **Settings → Copilot → Plus → Memory Folder Name** — default: `copilot/memory`
- **Update memory tool**: The AI can add, update, or remove memories when you ask

---

## Document Processor

When Copilot processes PDFs and other non-markdown files (in Plus mode), it converts them to markdown for the AI to read.

You can optionally save the converted markdown to a folder in your vault:

- **Setting**: **Settings → Copilot → Plus → Store converted markdown at**
- Leave empty to skip saving (conversion still happens, it just isn't persisted)

---

## Self-Host Mode

### What Is Self-Host Mode?

Self-Host Mode lets you replace Copilot's cloud services with your own infrastructure. Instead of relying on Copilot's Plus backend, you run everything locally or on your own server.

**Requires**: A Copilot Plus Lifetime or Believer license (not available on monthly subscriptions).

### What Self-Host Mode Enables

- Use local or custom LLM servers
- Custom web search via Firecrawl or Perplexity Sonar
- Local YouTube transcript extraction via Supadata
- Miyo desktop app for local PDF parsing, semantic search, and more

### Enabling Self-Host Mode

1. Go to **Settings → Copilot → Plus**
2. Under **Self-Host Mode**, toggle **Enable Self-Host Mode**
3. Copilot validates your license. If valid, the toggle activates.
4. Enter your **Self-Host URL** if you have a custom backend

### Web Search in Self-Host Mode

Choose your web search provider:

- **Firecrawl** — A web crawling and scraping API. Get a key at firecrawl.dev. Enter it in **Settings → Copilot → Plus → Firecrawl API Key**.
- **Perplexity Sonar** — An AI-powered search API. Get a key at perplexity.ai. Enter it in **Settings → Copilot → Plus → Perplexity API Key**.

### YouTube Transcription in Self-Host Mode

Use your own Supadata API key for YouTube transcript extraction:

- Get a key at supadata.ai
- Enter it in **Settings → Copilot → Plus → Supadata API Key**

---

## Miyo Desktop App

Miyo is a companion desktop app from the same developer that enhances Copilot with local, offline capabilities:

### What Miyo Provides

- **Local semantic search** — Fast vector search without embedding API calls
- **PDF parsing** — Converts PDFs to markdown locally (no cloud OCR)
- **Context hub** — Manages your indexed documents locally
- **Custom server URL** — Run Miyo on any machine (local or server)

### Setting Up Miyo

1. Download and install the Miyo desktop app
2. Start the Miyo server
3. In Copilot, go to **Settings → Copilot → Plus → Enable Miyo Search**
4. Miyo automatically connects to the local server (or use a custom URL in **Miyo Server URL**)
5. Index your vault — Copilot will use Miyo to generate and store embeddings locally

### Custom Miyo Server URL

If Miyo is running on a different machine (e.g., a home server), enter its address:

```
http://192.168.1.10:8742
```

Leave empty to use automatic local discovery.

---

## Related

- [Agent Mode and Tools](agent-mode-and-tools.md) — Using the autonomous agent
- [Vault Search and Indexing](vault-search-and-indexing.md) — How Miyo enhances semantic search
- [Getting Started](getting-started.md) — First-time setup
