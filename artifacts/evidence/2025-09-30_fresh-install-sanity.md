# Fresh Install Sanity – Evidence (Parallel Tool Calls Disabled ➜ Enabled Later)

- **Scenario:** Brand-new activation immediately after entering the Copilot API key.
- **Goal:** Confirm onboarding works, chat turns succeed, and indexing completes before toggling `parallelToolCalls` on.
- **Screenshots:**

  1. `images/2025-09-30_welcome-to-copilot-plus.png` – dialog immediately after key entry (Apply Now vs Later).
  2. `images/2025-09-30_indexing-progress.png` – vault indexing banner while refreshing embeddings (43/140).
  3. `images/2025-09-30_indexing-complete.png` – final “Indexing completed successfully!” toast.

  _Place the PNGs under `artifacts/evidence/images/` before attaching to the PR._

## Console Log Extract

```text
[ChatManager] Sending message: "hello "
plugin:copilot:30809 [MessageRepository] Added message with ID: msg-1759220646974-508abcsz3
plugin:copilot:30809 [ContextManager] Processing context for message msg-1759220646974-508abcsz3
plugin:copilot:30809 [ContextManager] Successfully processed context for message msg-1759220646974-508abcsz3
plugin:copilot:30809 [MessageRepository] Updated processed text for message msg-1759220646974-508abcsz3
plugin:copilot:30809 [ChatManager] Successfully sent message msg-1759220646974-508abcsz3
plugin:copilot:30809 Step 0: Initial user message:
 {id: 'msg-1759220646974-508abcsz3', message: 'hello \n\n', originalMessage: 'hello ', sender: 'user', timestamp: {...}, ...}
plugin:copilot:30809 [API /license request]: {is_valid: true, plan: 'believer'}
plugin:copilot:30809 Step 1: Analyzing intent
plugin:copilot:30809 Enabling Responses API for GPT-5 model: gpt-5-mini (openai)
plugin:copilot:30809 Chat model set with Responses API for GPT-5: gpt-5-mini
plugin:copilot:30809 Setting model to gpt-5-mini|openai
plugin:copilot:35394 New LLM chain created.
plugin:copilot:30809 [API /broca request]: {response: {...}, elapsed_time_ms: 2314.03}
plugin:copilot:30809 Invoking LLM with all tool results
plugin:copilot:30809 Enhanced user message:  hello
plugin:copilot:30809 Final request to AI {messages: 2}
plugin:copilot:30809 [MessageRepository] Added full message with ID: msg-1759220654670-9ykjtcv6j
plugin:copilot:30809 Chat memory updated:
 {turns: 2}
plugin:copilot:30809 Final AI response (truncated):
 Hello — I'm Obsidian Copilot. How can I help with your Obsidian notes or vault today? ...
plugin:copilot:30809 Setting model to gemini-2.5-flash|google
plugin:copilot:35394 New LLM chain created.
plugin:copilot:30809 [ChatManager] Sending message: "hello "
plugin:copilot:30809 [MessageRepository] Added message with ID: msg-1759220663405-7842ckcm9
plugin:copilot:30809 [ContextManager] Processing context for message msg-1759220663405-7842ckcm9
plugin:copilot:30809 [ContextManager] Successfully processed context for message msg-1759220663405-7842ckcm9
plugin:copilot:30809 [MessageRepository] Updated processed text for message msg-1759220663405-7842ckcm9
plugin:copilot:30809 [ChatManager] Successfully sent message msg-1759220663405-7842ckcm9
plugin:copilot:30809 Step 0: Initial user message:
 {id: 'msg-1759220663405-7842ckcm9', message: 'hello \n\n', originalMessage: 'hello ', sender: 'user', timestamp: {...}, ...}
plugin:copilot:30809 [API /license request]: {is_valid: true, plan: 'believer'}
plugin:copilot:30809 Step 1: Analyzing intent
plugin:copilot:30809 Setting model to gemini-2.5-flash|google
plugin:copilot:35394 New LLM chain created.
plugin:copilot:30809 [API /broca request]: {response: {...}, elapsed_time_ms: 2094.29}
plugin:copilot:30809 Condensing question
plugin:copilot:30809 Condensed standalone question:  hello
plugin:copilot:30809 Invoking LLM with all tool results
plugin:copilot:30809 Enhanced user message:  hello
plugin:copilot:30809 Final request to AI {messages: 4}
plugin:copilot:30809 [MessageRepository] Added full message with ID: msg-1759220674960-694dxbfr5
plugin:copilot:30809 Chat memory updated:
 {turns: 4}
plugin:copilot:30809 Final AI response (truncated):
 Hello again! How can I assist you with your Obsidian notes or vault today? ...
```
