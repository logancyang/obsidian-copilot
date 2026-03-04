# Chat Interface

The Copilot chat panel is the main way you interact with AI in Obsidian. This guide covers everything about the chat UI: modes, message controls, history, settings, and advanced features like auto-compact.

---

## Chat Modes

Copilot offers four modes. You can switch between them using the mode selector at the top of the chat panel.

### Chat
General-purpose conversation. Good for writing, brainstorming, summarizing, or any task where you want to talk to an AI. Your currently open note and selected text are automatically included as context.

### Vault QA (Basic)
Ask questions about your vault content. Copilot uses lexical search (keyword matching) to find relevant notes and passes them as context to the AI. No indexing required. Good for quick questions about your notes.

### Copilot Plus
The most powerful mode. Requires a [Copilot Plus](copilot-plus-and-self-host.md) license. Combines Chat and Vault QA with an autonomous agent that can:
- Search your vault and the web
- Read and edit notes
- Remember things across conversations
- Use a growing set of tools automatically

### Projects (alpha)
Focused workspaces with their own context, model, system prompt, and isolated chat history. Useful for keeping separate AI conversations per project. See [Projects](projects.md) for details.

---

## Sending Messages

Type your message in the input box at the bottom of the chat panel and press **Enter** to send (or **Shift+Enter** to add a new line). You can change the send key in Settings → Basic → **Default Send Shortcut**.

While the AI is generating a response, a **Stop** button appears. Click it to interrupt the stream at any time.

---

## Chat History

### Autosave

By default, Copilot automatically saves your conversations as markdown files in your vault. Each saved chat appears in the `copilot/copilot-conversations/` folder.

You can turn off autosave in Settings → Basic. When you start a new chat, any unsaved conversation is saved automatically.

### Chat File Name Format

The filename template controls how saved chats are named. The default is:

```
{$topic}@{$date}_{$time}
```

Where:
- `{$topic}` — An AI-generated title (or the first few words of your first message if AI titles are off)
- `{$date}` — Date in YYYY-MM-DD format
- `{$time}` — Time in HH-MM-SS format

All three variables are required. You can customize the format in Settings → Basic → **Conversation note name**.

### AI-Generated Titles

When **Generate AI chat title on save** is enabled (default), Copilot asks the AI to generate a short, descriptive title for the conversation when saving. When disabled, the first 10 words of your first message are used instead.

### Loading Previous Chats

Click the **clock/history icon** in the chat panel toolbar to open the Chat History list. You can:
- Browse previous conversations
- Click a conversation to load it and continue from where you left off
- Delete conversations you no longer need

The history list can be sorted by most recent or alphabetically.

---

## Per-Session Settings (Gear Icon)

Click the **gear icon** inside the chat panel to open per-session settings. These apply only to the current conversation and reset when you start a new chat:

- **System prompt** — Override the default system prompt for this session
- **Temperature** — Controls randomness (0 = deterministic, 1 = creative)
- **Max tokens** — Maximum length of the AI's response

---

## Token Counter

Copilot shows a token count indicator at the bottom of the chat. This estimates how many tokens are being used by your current context. Useful for knowing when you're approaching context limits.

---

## Auto-Compact

When a conversation grows very long, it can exceed the model's context window. Auto-compact automatically summarizes the older portion of the conversation and replaces it with a compressed summary, letting you continue chatting without losing track of what was discussed.

The threshold is configured in Settings → Basic → **Auto-compact threshold**, which defaults to 128,000 tokens. Valid range: 64,000–1,000,000 tokens.

When auto-compact triggers, you'll see a "Compacting" indicator in the chat. The conversation continues normally — older messages are replaced by a summary, so the AI still understands the history even though you can no longer scroll back to see the original messages.

---

## Suggested Prompts

When starting a new chat, Copilot may show suggested prompts based on your active note or previous conversations. You can enable or disable this in Settings → Basic → **Show suggested prompts**.

---

## New Chat Behavior

Click the **pencil/new chat icon** to start a fresh conversation. This:
1. Saves the current conversation (if autosave is enabled)
2. Clears the chat window
3. Resets the context to your currently active note

You can also use the command palette: **New Copilot Chat**.

---

## Related

- [Context and Mentions](context-and-mentions.md) — Control what context the AI sees
- [System Prompts](system-prompts.md) — Customize AI behavior with system prompts
- [Agent Mode and Tools](agent-mode-and-tools.md) — What Plus mode can do
- [Projects](projects.md) — Isolated workspaces with separate histories
