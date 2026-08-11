# Getting Started with Copilot for Obsidian

Copilot for Obsidian is an AI-powered plugin that brings large language models (LLMs) directly into your note-taking workflow. You can chat with AI, ask questions about your vault, run custom commands, search the web, and even have the AI edit your notes — all without leaving Obsidian.

## What Can Copilot Do?

- **Chat**: Have a conversation with an AI assistant
- **Vault Q&A**: Ask questions and get answers grounded in your own notes
- **Note editing**: Ask the AI to write or update your notes for you
- **Semantic search**: Find notes by meaning, not just keywords
- **Custom commands**: Run AI-powered prompts on selected text
- **Public sharing**: Publish Markdown notes to Symposium with a shareable link
- **Web search**: Fetch and summarize information from the internet
- **Memory**: Have the AI remember facts about you across conversations
- **Agent Mode**: Use OpenCode, Claude, or Codex for multi-step work in your vault on desktop

Copilot supports 16+ AI providers including OpenAI, Anthropic, Google Gemini, Ollama (local), and more.

---

## Installation

1. Open **Obsidian Settings** → **Community plugins**
2. Turn off **Safe mode** if prompted
3. Click **Browse** and search for **Copilot**
4. Click **Install**, then **Enable**

Copilot is now installed. An Agent icon appears in the left sidebar ribbon on desktop.

---

## First-Time Setup

### Step 1: Open Plugin Settings

Go to **Settings** → **Copilot** (scroll down to the Community Plugins section).

### Step 2: Add an API Key

On the **Basic** tab, click **Set Keys** to open the API key dialog. Enter the key for your chosen provider:

| Provider             | Where to get a key                          |
| -------------------- | ------------------------------------------- |
| OpenRouter (default) | https://openrouter.ai/keys                  |
| OpenAI               | https://platform.openai.com/api-keys        |
| Anthropic            | https://console.anthropic.com/settings/keys |
| Google Gemini        | https://makersuite.google.com/app/apikey    |

The default model is **OpenRouter Gemini 2.5 Flash**, which requires an OpenRouter API key. If you'd prefer a different provider, set up that key first, then change the default model.

### Step 3: Choose a Default Model

Add a provider and its models on the **Models (BYOK)** tab, then open **Basic → Agents → Quick Chat**: enable the ones you want to see in chat under **Quick Chat models**, and pick the one new chats start with under **Default model**.

### Step 4: Choose a Quick Chat Mode

Use the **Default Mode** dropdown to set which mode opens by default:

- **Chat** — General conversation, good for most tasks
- **Vault QA** — Ask questions answered from your notes
- **Copilot Plus** — Licensed Quick Chat mode with web, memory, and autonomous tools
- **Projects** — Focused workspaces (alpha feature)

Most users should start with **Chat** mode.

### Step 5: Set Up Agent Mode (Optional, Desktop)

Agent Mode is a separate desktop view for longer tasks. Click the **Agent** ribbon icon or run **Open Copilot Agent Chat Window**, then choose:

- **OpenCode** — recommended; Copilot can download and manage it for you.
- **Claude** — uses Claude Code and your Anthropic sign-in.
- **Codex** — uses Codex and your OpenAI sign-in.

A single-agent session does not require Copilot Plus. The selected agent still needs its own account or model access. See [Agent Mode and Tools](agent-mode-and-tools.md) for setup and permissions.

---

## Opening Quick Chat

You can open Copilot in several ways:

- Use the command palette: `Ctrl/Cmd+P` → **Open Copilot Chat Window**
- Use the hotkey `Ctrl/Cmd+P` → **Toggle Copilot Chat Window** to show/hide it

To open Agent Mode instead, click the **Agent** ribbon icon or run **Open Copilot Agent Chat Window**.

### Sidebar vs. Editor Tab

By default, Copilot opens as a **view** (sidebar panel). You can change this in Settings → Copilot → Basic → **Open chat in**:

- **View** — Opens in the sidebar, stays visible as you work
- **Editor** — Opens as an editor tab, giving it more screen space

---

## Your First Quick Chat Conversation

1. Open the chat panel
2. Type your message in the input box at the bottom
3. Press **Enter** (or **Shift+Enter** if you changed the send shortcut) to send
4. Watch the AI's response stream in real time
5. Continue the conversation naturally

The AI will automatically include your currently open note as context, so you can say things like "summarize this note" or "what are the action items in this note?"

---

## Publish a Note to Symposium

Run **Publish file to Symposium** from the command palette, a Markdown note's File explorer menu, its note menu, or the editor's **Copilot** submenu. Copilot asks for confirmation because anyone with the resulting link can read the published page.

After publishing, Copilot stores the full public link in the note's `symposium` property. Run the same action again to update the existing page or withdraw its public link. Symposium deletes its stored copy, but it cannot recall copies that readers or caches already fetched. Withdrawing the page also removes the property from the note.

Copilot appends successful publishes, updates, and withdrawals to the hidden Markdown history file at `.symposium/publish-history.md`. It is recovery history only: the note's `symposium` property remains the source of truth. If that property is damaged, recover the public link from the history file; its rows remain after a note is deleted.

If Publish or Delete succeeds but the note's property cannot be updated, reopening the dialog resumes that local change without contacting Symposium again. If the initial publish response is lost, Copilot blocks another attempt until the plugin reloads to avoid creating a duplicate page.

Updates fail closed. If Symposium rejects an update for any reason, including when the remote page is missing, Copilot preserves the note's existing `symposium` property and does not create a replacement page.

Copilot stops before publishing when a note's frontmatter is malformed or is not a YAML property map.

---

## Keyboard Shortcuts

These are the default shortcuts. You can customize them in **Obsidian Settings** → **Hotkeys** → search for "Copilot".

| Action                        | Default Shortcut                |
| ----------------------------- | ------------------------------- |
| Open Copilot Chat Window      | _(unbound — assign in Hotkeys)_ |
| Toggle Copilot Chat Window    | _(unbound — assign in Hotkeys)_ |
| New Copilot Quick Chat        | _(unbound — assign in Hotkeys)_ |
| Quick Ask (floating input)    | _(unbound — assign in Hotkeys)_ |
| Trigger Quick Command         | _(unbound — assign in Hotkeys)_ |
| Add selection to chat context | _(unbound — assign in Hotkeys)_ |

### Send Shortcut

By default, **Enter** sends a message and **Shift+Enter** adds a new line. You can swap this in Settings → Copilot → Basic → **Default Send Shortcut**.

---

---

## Glossary

**LLM (Large Language Model)**
The AI "brain" behind Copilot — a model trained on vast text to understand and generate human language, powering chat, summarization, and writing assistance.

**API (Application Programming Interface)**
A way for Copilot to communicate with external AI services. You provide an API key, which is like a password that lets Copilot use a provider's AI models on your behalf. Note: an OpenAI API key is _different_ from a ChatGPT Plus subscription — you don't need ChatGPT Plus to use Copilot.

**API Key**
A secret token from an AI provider that authorizes Copilot to make requests. Most providers require you to have a billing account with a positive balance.

**Token**
A small unit of text (roughly ¾ of a word) that AI models process. Tokens measure how much text the AI can handle at once and relate to usage costs.

**Context Window**
The amount of text the AI can consider at one time when generating a response. A larger context window means the AI can use more of your notes or conversation history.

**Embeddings**
A method of converting text into numbers that capture meaning. Embeddings let the AI find notes that are conceptually related, even if they don't share exact words.

**RAG (Retrieval-Augmented Generation)**
A technique that enhances AI responses by first searching for relevant notes, then generating an answer based on both your query and the retrieved content. This is how Vault QA works.

**Vector Store / Index**
A database that stores your notes as mathematical vectors (embeddings) so they can be searched by meaning. Think of it as a smart index that understands the context of your notes, not just their keywords.

---

## Next Steps

- [Chat Interface](chat-interface.md) — Learn about modes, history, and settings
- [Agent Mode and Tools](agent-mode-and-tools.md) — Set up an agent for multi-step work
- [LLM Providers](llm-providers.md) — Set up your preferred AI provider
- [Context and Mentions](context-and-mentions.md) — Control what context the AI sees
- [Vault Search and Indexing](vault-search-and-indexing.md) — Set up semantic search over your notes
