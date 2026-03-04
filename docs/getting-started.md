# Getting Started with Copilot for Obsidian

Copilot for Obsidian is an AI-powered plugin that brings large language models (LLMs) directly into your note-taking workflow. You can chat with AI, ask questions about your vault, run custom commands, search the web, and even have the AI edit your notes — all without leaving Obsidian.

## What Can Copilot Do?

- **Chat**: Have a conversation with an AI assistant
- **Vault Q&A**: Ask questions and get answers grounded in your own notes
- **Note editing**: Ask the AI to write or update your notes for you
- **Semantic search**: Find notes by meaning, not just keywords
- **Custom commands**: Run AI-powered prompts on selected text
- **Web search**: Fetch and summarize information from the internet
- **Memory**: Have the AI remember facts about you across conversations

Copilot supports 16+ AI providers including OpenAI, Anthropic, Google Gemini, Ollama (local), and more.

---

## Installation

1. Open **Obsidian Settings** → **Community plugins**
2. Turn off **Safe mode** if prompted
3. Click **Browse** and search for **Copilot**
4. Click **Install**, then **Enable**

Copilot is now installed. A robot icon will appear in the left sidebar ribbon.

---

## First-Time Setup

### Step 1: Open Plugin Settings

Go to **Settings** → **Copilot** (scroll down to the Community Plugins section).

### Step 2: Add an API Key

On the **Basic** tab, click **Set Keys** to open the API key dialog. Enter the key for your chosen provider:

| Provider | Where to get a key |
|---|---|
| OpenRouter (default) | https://openrouter.ai/keys |
| OpenAI | https://platform.openai.com/api-keys |
| Anthropic | https://console.anthropic.com/settings/keys |
| Google Gemini | https://makersuite.google.com/app/apikey |

The default model is **OpenRouter Gemini 2.5 Flash**, which requires an OpenRouter API key. If you'd prefer a different provider, set up that key first, then change the default model.

### Step 3: Choose a Default Model

Still on the **Basic** tab, use the **Default Chat Model** dropdown to select the model you want to use. Any model whose provider has an API key configured will be available.

### Step 4: Choose a Chat Mode

Use the **Default Mode** dropdown to set which mode opens by default:

- **Chat** — General conversation, good for most tasks
- **Vault QA** — Ask questions answered from your notes
- **Copilot Plus** — Advanced mode with autonomous agent and tools (requires Copilot Plus license)
- **Projects** — Focused workspaces (alpha feature)

Most users should start with **Chat** mode.

---

## Opening the Chat Panel

You can open Copilot in several ways:

- Click the **robot icon** in the left ribbon (sidebar)
- Use the command palette: `Ctrl/Cmd+P` → **Open Copilot Chat Window**
- Use the hotkey `Ctrl/Cmd+P` → **Toggle Copilot Chat Window** to show/hide it

### Sidebar vs. Editor Tab

By default, Copilot opens as a **view** (sidebar panel). You can change this in Settings → Copilot → Basic → **Open chat in**:
- **View** — Opens in the sidebar, stays visible as you work
- **Editor** — Opens as an editor tab, giving it more screen space

---

## Your First Conversation

1. Open the chat panel
2. Type your message in the input box at the bottom
3. Press **Enter** (or **Shift+Enter** if you changed the send shortcut) to send
4. Watch the AI's response stream in real time
5. Continue the conversation naturally

The AI will automatically include your currently open note as context, so you can say things like "summarize this note" or "what are the action items in this note?"

---

## Keyboard Shortcuts

These are the default shortcuts. You can customize them in **Obsidian Settings** → **Hotkeys** → search for "Copilot".

| Action | Default Shortcut |
|---|---|
| Open Copilot Chat Window | *(unbound — assign in Hotkeys)* |
| Toggle Copilot Chat Window | *(unbound — assign in Hotkeys)* |
| New Copilot Chat | *(unbound — assign in Hotkeys)* |
| Quick Ask (floating input) | *(unbound — assign in Hotkeys)* |
| Trigger Quick Command | *(unbound — assign in Hotkeys)* |
| Add selection to chat context | *(unbound — assign in Hotkeys)* |

### Send Shortcut

By default, **Enter** sends a message and **Shift+Enter** adds a new line. You can swap this in Settings → Copilot → Basic → **Default Send Shortcut**.

---

## Next Steps

- [Chat Interface](chat-interface.md) — Learn about modes, history, and settings
- [LLM Providers](llm-providers.md) — Set up your preferred AI provider
- [Context and Mentions](context-and-mentions.md) — Control what context the AI sees
- [Vault Search and Indexing](vault-search-and-indexing.md) — Set up semantic search over your notes
