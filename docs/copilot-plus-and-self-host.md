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
- **Included models** — A set of chat models that need no API key of your own, from fast everyday ones to top-tier reasoners ([the full list](#models-included-with-your-license))
- **URL processing** — Fetch and summarize web pages as context
- **Copilot Plus embedding models** — High-quality embeddings, selected under semantic search rather than by activating a license

### Setting Up Copilot Plus

1. Get a license key from your dashboard at **https://www.obsidiancopilot.com/en/dashboard**
2. Go to **Settings → Copilot → Basic** (or the Plus banner in the settings)
3. Enter your license key in the **Copilot Plus License Key** field
4. Features unlock automatically

A welcome dialog then offers to make **copilot-plus-flash** your default model.
Choosing **Apply Now** sets it as the default for chat and for each agent that
can run Copilot models — OpenCode today; Claude Code and Codex keep their own
models and are left alone. Choosing **Apply Later** changes nothing: the Copilot
models are already available in every picker either way, and you can set a
default yourself under **Settings → Basic → Agents**, per agent and for Quick Chat.

Applying it never changes your embedding model or rebuilds your vault index.
Semantic search is configured separately — see
[Vault search and indexing](vault-search-and-indexing.md).

The badge at the top of the license section names your plan once the key is
working — **Plus**, **Lite**, or **Lifetime** for a Believer or Supporter
purchase. It reads **Inactive** whenever the stored key grants nothing: a
subscription that ended, a key that was revoked or mistyped, or a plan whose
included access has run out. The plans link in that section is where you renew
or upgrade.

---

## Models included with your license

Your license comes with a set of models Copilot runs for you. None of them need
an API key of your own.

Three are switched on the moment your license activates, chosen to cover the
range: the fastest one, the strongest reasoner, and a frontier open model.

| Model                  | What it's for                                                        |
| ---------------------- | -------------------------------------------------------------------- |
| **Copilot Plus Flash** | The default. Fastest responses and the most quota. Accepts images.   |
| **DeepSeek V4 Pro**    | The hardest reasoning and agentic tasks.                             |
| **GLM-5.2**            | A long-horizon frontier open model that rivals the best closed ones. |

The rest are included too, switched off until you want them:

| Model                      | What it's for                                                    |
| -------------------------- | ---------------------------------------------------------------- |
| **DeepSeek V4 Flash 0731** | The newest DeepSeek V4 Flash snapshot: fast, cheap, and capable. |
| **Kimi K2.7 Code**         | Coding tasks. Accepts images.                                    |
| **Kimi K2.6**              | Long-running reasoning tasks.                                    |
| **MiMo V2.5**              | Cost-effective and capable for everyday use.                     |
| **MiniMax M2.7**           | Lightweight tasks, compact and efficient.                        |

Turn any of them on under **Settings → Basic → Agents**, in the list for the
place you want it: **Quick Chat** for the chat model picker, or an agent's own
list for Agent Mode.

### Where they show up

In **Quick Chat**, they appear in the model picker alongside any models you
added yourself.

In **Agent Mode**, the picker groups models by agent, and these appear inside
each agent that can run them — **OpenCode** today. **Claude Code** and **Codex**
bring their own models from their own subscriptions, so your Copilot models do
not appear under those two.

**Copilot Plus Flash** becomes the default for chat and for every agent that can
run it if you accept the offer in the welcome dialog when your license
activates — see [Setting Up Copilot Plus](#setting-up-copilot-plus) above.

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
- **Memory folder**: memories are stored in the `memory/` sub-folder of your Copilot folder — default `copilot/memory`. It follows the Copilot folder location (**Settings → Copilot → Basic → Copilot folder location**).
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
3. Copilot checks your plan. The toggle stays locked if your plan doesn't include Self-Host Mode.
4. Toggle **Enable Miyo** to use the Miyo desktop app for local search, PDF parsing, and context.
5. _(Optional)_ Set **Custom Miyo Server URL** only if Miyo is running on a remote machine. Leave blank to use automatic local service discovery.

**Working offline**: Self-Host Mode keeps working without an internet connection for a while after your last online check, and renews itself automatically whenever you're online. How long that offline period lasts currently varies, so reconnect when you can rather than relying on a fixed window.

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
