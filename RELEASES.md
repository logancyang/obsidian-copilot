# Release Notes

# Copilot for Obsidian - Release v3.2.1

A patch release with search improvements and bug fixes.

- **Improved vault search**: Better tag matching with hierarchical support (e.g. searching `#project` also matches `#project/alpha`) and a cleaner, faster search pipeline. (@loganyang)
- **New in-chat indexing progress**: Indexing progress now shows as a card inside Copilot Chat with a progress bar and pause/resume/stop controls, instead of a popup notice. No more phantom re-indexing on mode switch. (@loganyang)

### Bug Fixes

- #2176 Fix ENAMETOOLONG error when Composer creates files with long names @logancyang
- #2174 Fix insert/replace at cursor accidentally including agent reasoning blocks @logancyang
- #2173 Fix phantom re-indexing on mode switch @logancyang
- #2172 Fix search recall for tag queries and short terms @logancyang

## Troubleshoot

- If models are missing, navigate to Copilot settings -> Models tab and click "Refresh Built-in Models".
- Please report any issue you see in the member channel!

---

# Copilot for Obsidian - Release v3.2.0 💪💪💪

The first version of **Self-Host Mode** is finally here! You can simply toggle it on at the bottom of Plus settings, and **your reliance on the Copilot Plus backend is gone** (Believer required)!

In the next iterations, self-host mode will let you configure your own web search and YouTube services, and integrate with our new standalone desktop app for more powerful features, stay tuned!

- 🚀 **Autonomous Agent Evolution** — The agent experience gets a major upgrade this release!
  - ✨ **New reasoning block**: The new reasoning block replaces the old tool call banners for a cleaner and smoother UI in agent mode!
  - 🔧 **Native tool calling**: We moved to native tool calling from the XML-based approach for a more reliable tool call experience. Nowadays more and more models support native tool calling, even local models!
- Brand new **Editor "Quick Ask" Floating Panel**! Select text in the editor and get an inline AI floating panel for quick questions — with **persistent selection highlights** so you never lose your place! (@wyh)
- **Twitter/X thread processing**: Mention a tweet thread URL in chat and Copilot will fetch the entire thread! (@loganyang)
- **Modular context compaction architecture** — a cleaner, more extensible design for how Copilot manages long contexts. (@loganyang)
- **LM Studio and Ollama reasoning/thinking token support** — thinking models in LM Studio and Ollama now display reasoning output properly. (@loganyang)
- Major **search improvements**: better recall with note-diverse top-K scoring, and a new **"Build Index" button** replacing the warning triangle in Relevant Notes for a clearer UX. (@loganyang)

👨‍💻 **Known Limitations**: Agent mode performance varies by model, recommended models: Gemini Pro/Flash (copilot-plus-flash), Claude 4.5+ models, GPT 5+ and mini, grok 4 and fast. Many OpenRouter open source models work too but the performance can vary a lot.

More details in the changelog:

### Improvements

- #2139 Add Editor "Quick Ask" Floating Panel with Persistent Selection Highlights @Emt-lin
- #2146 Address quick ask refinements @logancyang
- #2149 Agent UI/UX Improvements @logancyang
- #2123 Migrate to native tool call in Plus and Agent modes @logancyang
- #2159 Implement modular context compaction architecture @logancyang
- #2155 Miyo Integration Phase 1: abstract semantic index backend @wenzhengjiang
- #2161 Add twitter4llm support for Twitter/X URL processing @logancyang
- #2151 Add reasoning/thinking token support for LM Studio @logancyang
- #2141 Add PatternListEditor component for include/exclude settings @Emt-lin
- #2164 Audit context envelope, tag alignment, artifact dedup, and logging @logancyang
- #2166 Update builtin models to latest versions across all providers @logancyang
- #2167 Remove HyDE query rewriting from HybridRetriever @logancyang
- #2168 Replace warning triangle with Build Index button in Relevant Notes @logancyang
- #2147 Update Ollama support @logancyang
- Show Self-Host Mode section to all users with disabled toggle for non-lifetime @logancyang

### Bug Fixes

- #2117 Fix: increase grep limit for larger vaults and unify chunking @logancyang
- #2137 Fix: prevent arrow keys from getting stuck in typeahead with no matches @ZeroLiu
- #2140 Fix: GitHub Copilot mobile CORS bypass and auth UX improvements @Emt-lin
- #2153 Fix LM Studio chat with only ending think tag @logancyang
- #2157 Fix: improve mobile keyboard/navbar CSS scoping and platform detection @Emt-lin
- #2160 Fix: remove tiktoken remote fetch from critical LLM path @logancyang
- #2165 Fix search recall with note-diverse top-K and chunk-aware scoring @logancyang

## Troubleshoot

- If models are missing, navigate to Copilot settings -> Models tab and click "Refresh Built-in Models".
- Please report any issue you see in the member channel!

---

# Copilot for Obsidian - Release v3.1.5 🔥

Our first release in 2026 has some long-awaited upgrades!

- Copilot can **read web tabs in Obsidian** now!! 🚀 With the new builtin **YouTube and web clipper slash commands** (use "generate default" button under the Commands settings tab), you can get beautiful clips with mindmap with just one prompt! 🤯
- We now have a new **custom system prompt system** where every system prompt is **stored as a markdown file**. You can add and **switch your custom system prompt** in the Advanced settings tab or just above the chat input via the new gear icon!
- As requested, we now have a new **side-by-side diff view** for composer edits! You can toggle between the inline diff view and side-by-side when a diff is displayed.
- New **auto compact** when the context attached is too long and overflows your model's context window. You can set the token threshold, default is 128k tokens. If you want it to be less aggressive, set it to 1M tokens.
- **OpenRouter embedding models** are supported! You can simply add them using the **OpenRouter provider** in the embedding model table.

There are a lot more upgrades, including a significant improvement in index-free search, better sorting of chat history and projects, composer auto-accept toggle in the chat input menu (the 3 dots), a new LLM provider "GitHub Copilot", etc. Huge shoutout to @Emt-lin for the significant contributions!

More details in the changelog:

### Improvements

- #2110 Add GitHub Copilot integration with improved robustness @Emt-lin
- #2113 Add streaming support for GitHub Copilot @Emt-lin
- #1969 Add comprehensive system prompt management system @Emt-lin
- #2098 Enhance Model Settings with Local Services and Curl Command Support @Emt-lin
- #2096 Add Web Viewer bridge for referencing open web tabs in chat @Emt-lin
- #2112 Support OpenRouter embeddings @logancyang
- #2106 Implement compaction with adjustable threshold and loading messages @logancyang
- #2108 Simplify diff views to side-by-side and split modes with word-level highlighting @wenzhengjiang
- #2087 Add file status and think block state indicators @Emt-lin
- #2077 Add recent usage sorting for chat history and project list @Emt-lin
- #2076 Add auto-accept edits toggle in chat control setting @wenzhengjiang
- #2003 Refactor model API key handling and improve model filtering @Emt-lin
- #2073 Bring back toggle for inline citation @logancyang
- #2081 Update ApiKeyDialog layout for better visibility @Pleasurecruise
- #2115 Adjust settings @logancyang

### Bug Fixes

- #2114 Fix default indicator and slash command @Emt-lin
- #2109 Fix dependencies @logancyang
- #2099 Always process think blocks regardless of current model selection @Emt-lin
- #2100 Fix view-content padding for different display modes @Emt-lin
- #2101 Fix search v3 ranking @logancyang

## Troubleshoot

- If models are missing, navigate to Copilot settings -> Models tab and click "Refresh Built-in Models".
- Please report any issue you see in the member channel!

---

# Copilot for Obsidian - Release v3.1.4 🔥

**It's our 100th release!!** 🚀 This release includes

- Fixed a critical bug that makes the UI laggy when there's a long conversation
- A major Relevant Notes algorithm improvement
- Big step toward self-host mode by deprecating several modules and moving forward

More details in the changelog:

### Improvements

- #2073 Bring back toggle for inline citation @logancyang
- #2071 Clean up dead code and update readme for privacy disclosure @logancyang
- #2070 Enhance error handling in BaseChainRunner @logancyang
- #2069 Deprecate IntentAnalyzer @logancyang
- #2063 Improve new user onboarding by removing notice on missing api key @logancyang
- #2052 Improve relevant note search algorithm @zeroliu
- #2049 Add path to variable_note format and reorder elements @wenzhengjiang

### Bug Fixes

- #2072 Prevent orphaned spinners in agent @logancyang
- #2038 Revert "Improve onboarding by removing the popups … #2015" @logancyang

## Troubleshoot

- If models are missing, navigate to Copilot settings -> Models tab and click "Refresh Built-in Models".
- Please report any issue you see in the member channel!

---

# Release v3.1.3

This release includes

- Significant enhancements to AWS Bedrock support
- A new automatic text selection to chat context feature (default to off under Basic setting)
- Better user experience with composer - skip confirmation with an explicit instruction
- Reduced popups during onboarding

More details in the changelog:

## Improvements

- #2023 Enable agent by default @logancyang
- #2018 Add auto selection to context setting @logancyang
- #2017 Implement auto context inclusion on text selection @logancyang
- #2015 Improve onboarding by removing the popups @logancyang
- #2011 Update bedrock model support @logancyang
- #2008 Add anthropic version required field for bedrock @logancyang
- #2010 Multiple UX improvement @zeroliu
- #2002 Enhance writeToFile tool with confirmation option @wenzhengjiang
- #2014 Update log file @logancyang
- #2007 Add AWS Bedrock cross-region inference profile guidance @vedmichv

## Bug Fixes

- #2016 Fix thinking model verification @logancyang
- #2024 Do not show thinking if reasoning is not checked @logancyang
- #2012 Fix bedrock model image support @logancyang
- #2001 Fix template note processing @zeroliu

---

# Release v3.1.2

Release time again 🎉 We are ramping up to reach our big goals sooner! Some major changes

- 🫳 Drag-n-drop files from file navbar to Copilot Chat as context!
- 🧠 Revamped context management system that saves tokens by maximizing token cache hit
- 📂 Better context note loading from saved chats
- ↩️ New setting under Basic tab to set the send key - Enter / Shift + Enter
- 🔗 Embedded note `![[note]]` now supported in context

More details in the changelog:

### Improvements

- #1996 Support Tasks codeblock in AI response @logancyang
- #1995 Support embedded note in context @logancyang
- #1988 Update Corpus-in-Context and web search tool guide @logancyang
- #1979 Add SiliconFlow support for chat and embedding models @qychen2001
- #1982 Simplify log file @logancyang
- #1968 Add configurable send shortcut for chat messages @Emt-lin
- #1973 Integrate ProjectChainRunner and ChatManager with new layered context @logancyang
- #1971 Context revamp - Introduces layered context handling @logancyang
- #1964 Support drag-n-drop files from file navbar @zeroliu
- #1962 Prompt Improvement: Use getFileTree to explore ambiguous notes and folders @wenzhengjiang
- #1963 Stop condensing history in plus nonagent route @logancyang

### Bug Fixes

- #1997 Enhance local search guidance prompt @logancyang
- #1994 Fixes rendering issues in saved chat notes when model names contain special characters @logancyang
- #1992 Fix HyDE calling the wrong model @logancyang
- #1976 Fix ENAMETOOLONG @logancyang
- #1975 Fix indexing complete UI hanging @logancyang
- #1977 Fix thinking block duplication text for openrouter thinking models @logancyang
- #1987 Focus on click copilot chat icon in left ribbon @logancyang
- #1986 Focus to chat input on opening chat window command @logancyang

---

# Release v3.1.1

This patch release 3.1.1 packs a punch 💪 with some significant upgrades and critical bug fixes.

- OpenRouter thinking models are supported now! As long as "Reasoning" is checked for a reasoning model from OpenRouter, the thinking block will render in chat. If you don't want to see it, simply uncheck "Reasoning" to hide it.
- Copilot can see Dataview results in the active note! 🔥🔥🔥 Simply add the active note with dataview queries to context, and the LLM will see the executed results of those queries and use them as context!
- New model provider Amazon Bedrock added! (We only support API key and region settings for now, other ways of Bedrock access are not supported)

More details in the changelog:

### Improvements

- #1955 Add bedrock provider @logancyang
- #1954 Enable Openrouter thinking tokens @logancyang
- #1942 Improve custom command @zeroliu
- #1931 Improve error handling architecture across chain runners @Emt-lin
- #1929 Add CRUD to Saved Memory @wenzhengjiang
- #1928 Enhance canvas creation spec with with JSON Canvas Spec @wenzhengjiang
- #1923 Turn autosaveChat ON by default @wenzhengjiang
- #1922 Sort notes in typeahead menu by creation time @zeroliu
- #1919 Implement tag list builtin tool @logancyang
- #1918 Support dataview result in active note @logancyang
- #1914 Turn on memory feature by default @wenzhengjiang

### Bug Fixes

- #1957 Fix ENAMETOOLONG error on chat save @logancyang
- #1956 Enhance error handling @logancyang
- #1950 Fix new note (renamed) not discoverable in Copilot chat @logancyang
- #1947 Stop rendering dataview result in AI response @logancyang
- #1927 Properly render pills in custom command @zeroliu

---

# Copilot for Obsidian - Release v3.1.0 🔥

3.1.0 finally comes out of preview!! 🎉🎉🎉 This release introduces significant advancements in chat functionality and memory management, alongside various improvements and bug fixes.

## New Features

- **Brand New Copilot Chat Input:** A completely redesigned chat input! This is a huge update we introduced after referencing all the industry-leading solutions.
  - **Enhanced Context Referencing:** A new typeahead system allows direct referencing of notes, folders, tags, URLs, and tools using familiar syntax like `@`, `[[`, `#`, and `/`.
  - **Interactive "Pills":** Referenced items appear as interactive pills for a cleaner interface and easier management. No tripping over typos again!
- **Long-Term Memory (plus):** A major roadmap item, this feature allows Copilot to reference recent conversations and save relevant information to long-term memory. Memories are saved as `.md` files in the `copilot/memory` directory by default (configurable), allowing for inspection and manual updates.
  - Major item on the roadmap, making its debut
  - Enable "Reference Recent Conversation" and "Reference Saved Memory" in Plus settings
  - AI can see a summary of recent chats
  - AI can save and reference relevant info to long-term memory on its own
  - Option to manually trigger save by asking the agent or using the new `@memory` tool
  - Memories saved as md files under copilot/memory by default
  - Users can inspect or update memories as they like
- **Note Read Tool (plus agent mode):** A new built-in agentic tool that can read linked notes when necessary.
- **Token Counter:** Displays the number of tokens in the current chat session's context window, resetting with each new chat.
- **Max-Token Limit Warning:** Alerts users when AI output is cutoff due to low token limits in user setting.
- **YouTube Transcript Automation (plus):** YouTube transcripts are now fetched automatically when a YouTube URL is entered in the chat input. A new command, `Copilot: Download YouTube Transcript`, is available for raw transcript retrieval.
- **Projects Mode Enhancements (plus):** Includes a new Chat History Picker and an enhanced progress bar.
- **Backend & Tooling:**
  - Optimized agentic tool calls for smoother operation
  - Migration of backend model services.
  - Better search coverage when Semantic Search toggle is on.
  - Better agent debugging infra

## Breaking Changes

- The `@pomodoro` and `@youtube` tools have been removed from the tool picker.
- (plus) Sentence and word autocomplete features are temporarily disabled due to unstable performance, with plans to reintroduce them with user-customizable options.

## Bug Fixes

- Fix random blank screen on Copilot Chat UI

* Addressed issues with extracting response text, mobile typeahead menu size, chat crashes, tool call UI freezes, and chat saving.
* Fixed illegal saved chat file names and improved image passing with `copilot-plus-flash`.
* Avoided unnecessary index rebuilds upon semantic search toggle changes.
* Ensured autonomous agent workflows use consistent tool call IDs and helper orchestration.
* Resolved issues with dropdown colors, badge borders, search result numbers, folder context, and spaces in typeahead triggers.
* Fix model addition in "Set Keys" window. "Verification" no longer required
* Fix verification of certain Claude models (was complaining about top p -1 before, now it works)

## Troubleshoot

- If models are missing, navigate to Copilot settings -> Models tab and click "Refresh Built-in Models".
- Users are encouraged to report any issues in the pre-release channel.

---

# Release v3.0.3

This release has some big changes despite being a patch version. Notable changes:

- Introducing **Inline Citations**! Now any vault search response has inline citations and a collapsible sources section below the AI response. You have the option to toggle it off in QA settings. (This feature is experimental, if it's not working please report back!)
- Implement **Log File**, now you can share Copilot Log in the Advanced Setting, no more dev console!
- Removed User / Bot icons to save space in the Copilot Chat UI
- Add OpenRouter GPT 4.1 models and grok-4-fast to Projects mode
- Now AI-generated title for saved chats is optional, it's a toggle in the Basic setting
- Add new default `copilot/` parent folder for saved conversations and custom prompts
- Embedding model picker is no longer hidden under QA settings tab

Detailed changelog:

### Improvements

- #1838 Update sources styling @logancyang
- #1837 Drop user and bot icons to save space and add shade to user message @logancyang
- #1813 Add mobile-responsive components for settings @Emt-lin
- #1832 Add OpenRouter GPT-4.1 models to projects mode @logancyang
- #1831 Refactor active note inclusion and index event handling to respect setting @logancyang
- #1821 Implement inline citation @logancyang
- #1829 Agent Mode: Map copilot `@command` to builtin agent tools @wenzhengjiang
- #1817 Conditionally initialize VectorStoreManager @logancyang
- #1816 Ensure nested folder paths exist when enhancing folder management @logancyang
- #1811 Make AI chat title optional @logancyang
- #1810 Move context menu and markdown image handling settings @logancyang
- #1809 Show embedding model @logancyang
- #1805 Add search explanation table in log @logancyang
- #1804 Implement log file @logancyang
- #1788 Only scroll to bottom when user messages are added @zeroliu

### Bug Fixes

- #1840 Adjust vertical positioning in ModelTable component @logancyang
- #1830 Ensure proper QA exclusion on copilot data folders @logancyang
- #1827 Fix chat crash issue @zeroliu
- #1796 Support creating new folders in composer tools @wenzhengjiang
- #1795 Add safe area bottom padding to view content @Emt-lin
- #1793 Fix mobile embedded image passing @logancyang
- #1787 Improve loading state management in project context updates @Emt-lin
- #1786 Optimize modal height and close button display on mobile @Emt-lin
- #1778 Improve regex for composer codeblock @wenzhengjiang

---

### Improvements

- #1775 Switch to the new file when creating files with composer tools. @wenzhengjiang

### Bug Fixes

- #1776 Fix url processing with image false triggers @logancyang
- #1770 Fix chat input responsiveness @zeroliu
- #1773 Fix canvas parsing in writeToFile tool @wenzhengjiang

---

# Quick Hotfixes

- Fix a critical bug that stopped `[[note]]` reference from working in the free chat mode after introducing the context menu in v3.
- Optimize the replace writer tool
- Add a MSeeP security badge

---

# Copilot for Obsidian v3.0.0!

We are thrilled to announce the official release of Copilot for Obsidian v3.0.0! After months of hard work, this major update brings a new era of intelligent assistance to your Obsidian vault, focusing on enhanced AI capabilities, a new search system, and significant user experience improvements.

## 🏞️ Image Support and Chat Context Menu

Image support and the chat context menu are available for free users now! As long as your model supports vision, you can check the vision box and send image(s) to it.

## 🔥 Copilot Vault Search v3 - Index-Free & Optional Semantic Search

We've completely reimagined how Copilot finds notes in your vault, making the search feature significantly more intelligent, robust, and efficient.

- **Smart Index-Free Search**: Search now works out-of-the-box without requiring an index build, eliminating index corruption issues.
- **Enhanced Relevance**: Copilot leverages keywords from titles, headings, tags, note properties, Obsidian links, co-citations, and parent folders to find relevant notes.
- **Optional Semantic Engine**: For semantic understanding, you can enable Semantic Search under QA settings, which uses an embedding index same as before.
- **Memory Efficient**: Uses minimal RAM, you can tune it under QA settings.
- **Privacy First**: The search infrastructure remains **local**; no data leaves your device unless you use an online model provider.
- **New QA Settings**:
- The embedding model is moved here from the Basic tab.
- **Lexical Search RAM Limit**: Control RAM usage for index-free search, allowing optimization for performance or memory constraints.

## ⌘ Introducing Inline Quick Command

Transform your inline editing workflow with the brand new "Copilot: trigger quick command." This feature replaces the legacy "apply adhoc custom prompt" and allows you to insert quick prompts to edit selected blocks inline, integrating seamlessly with your custom command workflow. Assigning it to a hotkey like `Cmd (Ctrl) + K` is highly recommended!

## 🚀 Autonomous Agent (Plus Feature)

Experience a new level of AI interaction with the Autonomous Agent. When enabled in Plus settings, your Copilot can now automatically trigger tool calls based on your queries, eliminating the need for explicit `@tool` commands.

- **Intelligent Tool Calling**: The agent can automatically use tools like vault search, web search, composer and YouTube processing to fulfill your requests.
- **Tool Call Banner**: See exactly which tools the agent used and their results with expandable banners.
- **Configurable Tools**: Gain fine-grained control by enabling or disabling specific tools that the agent can call (Local vault search, Web search, Composer operations, YouTube processing) in the Plus settings.
- **Max Iterations Control**: Adjust the agent's reasoning depth (4-8 iterations) for more complex queries.
- **Supported Models**: Optimized for `copilot-plus-flash` (Gemini 2.5 models), Claude 4, GPT-4.1, GPT-4.1-mini, and now GPT-5 models. (Note: Agent mode performs best with Gemini models, followed by Claude and GPT. (Performance can vary a lot if you choose other models)
- **Control Remains Yours**: For more control, turn the agent toggle off. vault search and web search are conveniently available as toggle buttons below the chat input.

## ✨ Other Key Improvements

- **Tool Execution Banner**: Visual feedback when the agent uses tools.
- **Better Tool Visibility**: Tool toggle buttons in chat input when the agent is off (vault search, web search, composer).
- **Improved Settings UI**: Dedicated "Agent Accessible Tools" section with clear framing.
- **ChatGPT-like Auto-Scroll**: Chat messages now auto-scroll when a new user message is posted.
- **Image Support**: Improved embedded image reading, no longer requiring "absolute path" setting for same-title disambiguation. Supports markdown-style embedded image links `![](link)`.
- **AI Message Regeneration**: Fixed issues with AI message regeneration.
- **Tool Result Formatting**: Enhanced formatting for tool results.
- **UI Responsiveness**: Better UI responsiveness during tool execution.
- **Context Menu**: Moved context menu items to a dedicated "Copilot" submenu.
- **Model Parameters**: Top P, frequency penalty, verbosity, and reasoning effort model parameters are now optional and can be toggled manually.
- **Project Mode Context UI**: A new progress bar indicates when project context is loading, with status visible via the context status icon.
- **Embedding Models**: Gemini embedding 001 is added as a built-in embedding model. The embedding model picker is now under the QA tab.
- **OpenRouter**: Now the top provider in settings.

## 🙏 Thanks

Huge thanks to all our contributors and users, Copilot for Obsidian is nothing without its community! Please provide feedback if you encounter any issues.

---

# Release v2.9.5

Adding GPT-5 series models as built-in models, fresh out of the oven! Supports the new parameters `reasoning_effort` and `verbosity`. To see them, you may have to click "Refresh Builtin Models" under your chat model table in Copilot settings.

<img width="644" height="184" alt="SCR-20250808-itdy" src="https://github.com/user-attachments/assets/158323ce-8643-489b-824c-a457ea71fd4c" />

<img width="942" height="125" alt="SCR-20250808-jaok" src="https://github.com/user-attachments/assets/91d56c8d-9886-4d0e-b275-c251d62fec6b" />

You can also add openrouter GPT-5 models such as `openai/gpt-5-chat` as a Custom Model with the OpenRouter provider.

This is an unscheduled release to add GPT-5. **Copilot v3** is under construction and will be released officially very soon, stay tuned!

---

# Release v2.9.4

Yet another quick release fixing a few bugs: fix composer canvas codeblock, update copilot-plus-small (it hasn't been stable recently, should be stable now after a complete reindex)

#### PRs

- #1621 Exclude copilot folders from indexing by default @logancyang
- #1620 Disallow file types in context @logancyang
- #1619 Fix copilot-plus-small @logancyang
- #1617 Fix composer canvas codeblock @wenzhengjiang

## Troubleshoot

- If you find models missing in any model table or dropdown, go to Copilot settings -> Models tab, find "**Refresh Built-in Models**" and click it. If it doesn't help, please report back!
- For `@Believer` and `@poweruser` who are on a preview version, now you can use BRAT to install official versions as well!

---

# Copilot for Obsidian - Release v2.9.3

Another quick one fixing a default model reset issue introduced in v2.9.2.

Fixed a `/` command mistrigger issue, it now requires a preceding space to trigger.

Added rate limit to our Projects mode file conversion due to heavy load (some users have been passing 10k-100k pages of pdfs repeatedly), right now the limit is set to (50 or 100MB of non-markdown docs) per 3 hours per license key.

## PRs

- #1603 Add Projects rate limit UI change @logancyang
- #1602 Update file upload guidelines and rate limit information @logancyang
- #1600 Fix slash trigger @logancyang
- #1599 Fix default model reset @logancyang

## Troubleshoot

- If you find models missing in any model table or dropdown, go to Copilot settings -> Models tab, find "**Refresh Built-in Models**" and click it. If it doesn't help, please report back!

---

# Copilot for Obsidian - Release v2.9.2

A quick patch on top of v2.9.1. Now you don't need to manually `@youtube` to get the transcript, simply include the youtube url(s) in your chat message and their transcripts will be available in the context. (`@youtube <url>` for the transcript still works). Another critical fix is for free users - no more license key check popup if you happen to have autocomplete on.

Small UX improvement from our community contributor: improved message editing; autosave on current chat at every message to avoid loss of data in case of an app crash.

Added `(free)` to free modes.

### PRs

- #1594 Implement auto youtube tool @logancyang
- #1589 Improved message editing UX by adding Escape key cancellation and removing auto-save on blur @Mathieu2301
- #1593 Fix auto index trigger @logancyang
- #1592 Disable autocomplete by default and prevent license key popup for free user @logancyang

## Troubleshoot

- If you find models missing in any model table or dropdown, go to Copilot settings -> Models tab, find "**Refresh Built-in Models**" and click it. If it doesn't help, please report back!
- For `@Believer` and `@poweruser` who are on a preview version, please backup your current `<vault>/.obsidian/plugins/copilot/data.json`, reinstall the plugin and copy the data.json back to safely migrate to this update

---

# Copilot for Obsidian - Release v2.9.1

One big change in this release is the **migration of Copilot custom commands**, they are now saved as notes, same as custom prompts. We are unifying both into one system. Now you can edit them in Copilot settings under the Commands tab, or directly in the note, to enable them in the right-click menu or via `/` slash commands in chat. Please let us know if you have any issues with this migration!

## Other Significant Improvements

- **OpenRouter Gemini 2.5 models** added as builtin models, available in Projects mode as well! (Please click "Refresh Builtin Models" under the model table if you don't see them)
- Every model is configurable with its **own parameters** such as temperature, max tokens, top P, frequency penalty. Global params are removed to avoid confusion.
- Projects mode now has a **new context UI**! It's much easier to set and check the files under a project now!
- Introduced a new Copilot command "**Add Selection to Chat Context**" that adds the selected text to the chat context menu in Copilot Chat. It's also available in the right-click menu. (If you are familiar with Cursor, you can also assign this command with `cmd + shift + L` shortcut)
- Files such as PDFs and EPUBs that are converted to markdown in Projects mode are **cached as markdown** now, find them under `<vault>/.copilot/file-content-cache/`. (Moving them out into the vault makes them indexable by Copilot, but keep in mind it may blow up your index size!)
- Slash command `/` can be **triggered anywhere** in the chat input now (used to only trigger when input is empty), even mid-text!
- Various bug fixes.

### PRs

- #1584 Enable model params for copilot-plus-flash @logancyang
- #1580 Update max token default description in setting page @wenzhengjiang
- #1576 Add support for selected text context in chat component @logancyang
- #1575 Implement slash command detection and replacement in ChatInput @logancyang
- #1572 Update file cache to use markdown instead of json @logancyang
- #1571 Update ChatModels and add new OpenRouter models @logancyang
- #1570 Update dependencies and enhance project context modal @logancyang
- #1566 Enhance abort signal in chains @logancyang
- #1562 Support editing all parameters individually for each model @Emt-lin
- #1551 Support project context preview @Emt-lin
- #1549 Merge custom command with custom prompts @zeroliu
- #1581 Composer: fix compose block for empty note @wenzhengjiang
- #1568 Fix word completion triggers @logancyang
- #1560 Remove think tag for insert into note @logancyang
- #1552 Fix: Custom model verification, api key errors @Emt-lin

## Troubleshoot

- v2.9.1 has a custom commands migration, please find those custom commands that failed the migration in your under an "unsupported" subfolder in your custom prompt folder. Please review the reason it failed and update properly to keep them supported.
- If you find models missing in any model table or dropdown, go to Copilot settings -> Models tab, find "**Refresh Built-in Models**" and click it. If it doesn't help, please report back!
- For `@Believer` and `@poweruser` who are on a preview version, please backup your current `<vault>/.obsidian/plugins/copilot/data.json`, reinstall the plugin and copy the data.json back to safely migrate to this update

---

# Creating the AI Environment for Thinkers and Writers

Massive update to Copilot Plus!!🔥🔥🔥

Announcing our "3 milestones" (previously in believer-exclusive preview) in the brand new v2.9.0:

## Projects mode (alpha)

A new Plus mode where you can define a combo of your custom instruction, model, parameters and context as individual workspaces, powered by models with a 1M-token context window and context caching.

This is different from @vault, you can ask much more abstract questions here such as "find common patterns/most important insights"
Supports 20+ file types including PDF, EPUB, PPTX, DOCX, CSV, and many more.

(Since it's still in Alpha, the models still require your own API key, so keep an eye on your model provider's dashboard to avoid a surprise bill! The context processing is on us by our servers, we process those papers and books for you to have them ready for AI consumption.)

## Composer

Edit or create notes by just chatting with Copilot. Trigger it by explicitly including `@composer` in your message. The AI will suggest an edit, you click Preview/Apply, and a **diff view** shows up for you to accept the edits by line or in bulk.

Composer supports canvas, too!

## Autocomplete

Suggests the next words based on the content in your vault (toggle Allow Additional Context in Plus mode to allow more relevant context in your vault), supports most languages

- Sentence completion: suggests possible next words
- Word completion: completes partial words based on existing words in your vault

You can toggle them on or off separately, e.g. have only word completion if you find sentence completion distracting.
New Plus tab in Copilot settings

## Others

- Implement chat history picker button, render Save Chat as Note conditionally when Autosave is off
- Toggle to always include current file in the context by default (Plus setting tab)
- Autocomplete settings, customizable key binding
- A new Refresh Built-in Models button below the Models table
- Claude 4 and 3.7 sonnet thinking tokens support
- Add "Force rebuild index" to the 3-dots menu at the top right of the chat input
- "Save Chat as Note" does not open the saved note automatically anymore, as requested by users
- New Chat is now a copilot command assignable with a hotkey
- Quick add for models in the API key setting page, now it grabs the list of all available models from provider for you to pick from.
- Custom Prompts Sort Strategy in Advanced settings

## Troubleshoot

If you find models missing in any model table or dropdown, go to Copilot settings -> Models tab, find "**Refresh Built-in Models**" and click it. If it doesn't help, please report back!

## Acknowledgements

This is a joint effort by the Copilot team: @wenzhengjiang @zeroliu @Emt-lin @logancyang. It's impossible to achieve without the support and awesome feedback from our great community. We have a lot more upgrades coming in our pipeline, with some massive changes to the free features as well. Please stay tuned!

---

# Release v2.8.9

GPT 4.1 models and o4-mini are supported, and xAI is added as a provider! Another big update is canvas support! You can add canvas in your context by either a direct reference `[[]]` or the `+` button in your chat context menu! Copilot can even understand the group structure!

### Improvements

- #1461 Implement canvas adaptor @logancyang
- #1459 Support gpt 4.1 series, o4-mini and grok 3 @logancyang
- #1463 Switch insert and copy buttons and add more spacing @logancyang
- #1460 Add a toggle to turn custom prompt templating off @logancyang
- #1421 Ollama ApiKey support @sargreal
- #1441 refactor: Optimize some user experiences. @Emt-lin
- #1446 Improve custom command (v3) @zeroliu
- #1436 Pass project state to broca call @wenzhengjiang
- #1415 Add update notification @zeroliu
- #1414 Update broca requests @zeroliu

### Bug Fixes

- #1385 Fix Azure OpenAI chat model baseURL construction logic. @doin4
- #1450 fix: Add a new line when press the Enter key on mobile. @Emt-lin
- #1457 Fix image in note logic @logancyang

---

# Release v2.8.8

In this release, multimodal LLMs can see the images in your note context! Official DeepSeek is added as a chat model provider, and streaming of its thinking tokens is supported as well! There are some other usability upgrades and bug fixes as well, check the change log for more details.

### Improvements

- #1404 Add DeepSeek official API provider and support thinking stream @logancyang
- #1398 Implement passing of images in note to LLM @logancyang
- #1391 Fix wikilinks in codeblocks @logancyang
- #1348 Improve command usability @zeroliu

### Bug Fixes

- #1405 Encrypt embedding model api keys @logancyang
- #1397 Fix custom prompt with dash in its title @logancyang
- #1396 Fix gemini table generation and index integrity delay @logancyang
- #1351 Use simplified File Tree when it's larger than 0.5MB @wenzhengjiang
- #1380 Add plus-exclusive and believer-exclusive checks in embeddingManager @logancyang

---

# Release v2.8.7

Introducing **User Custom Inline Commands**! You can find them in the new **Command** tab in Copilot settings. Once you add your own commands, they appear in your right-click menu!

<img width="410" alt="SCR-20250305-nkhk" src="https://github.com/user-attachments/assets/32743c64-6e96-4b68-bdc4-5a62a79aeb90" />
<img width="401" alt="SCR-20250305-nkoo" src="https://github.com/user-attachments/assets/c449f28a-efea-40f2-9334-fd6241951406" />

We decided to remove the old 2-level "Translate" and "Tone" commands since it's impossible to make the same prompt work for all models. You are encouraged to make your own commands using the builtin commands as examples. For example, for translation it's better to make your own command for the particular languages you need.
(Note: this is inline-focused and is separate from **Custom Prompts**, you can still use custom prompts with slash or copilot commands same as before).

This release also has many UI/UX improvements: a chat input with better "generating" and "stop" display, better Relevant Notes display, better vault structure understanding in Plus mode, better vault search support for partial match on note titles, etc.

### Improvements

- #1332 Implement replace at cursor @logancyang
- #1329 Update auto index logic @logancyang
- #1328 Search improvements @logancyang
- #1327 Add description to custom command @zeroliu
- #1316 Enhance custom command @zeroliu
- #1298 Enhancement: Add file counts to file tree and remove file list from large file trees @wenzhengjiang
- #1284 File Tree: support exclusion and inclusion rules and simplify JSON structure @wenzhengjiang
- #1321 Add tooltip when exclusion/inclusion text overflows @zeroliu
- #1319 Improve relevant note UI @zeroliu
- #1318 Improve chat input UI @zeroliu
- #1305 Some UX optimizations @Emt-lin

### Bug Fixes

- #1330 Add async mutex for thread-safe database upsert operations @logancyang
- #1306 Fix: Replacing Node's Buffer with npm's buffer package. Improves mobile compatibility @Emt-lin
- #1331 Fix: Do not stringify tool_output if it is already a string @wenzhengjiang
- #1320 Fix plus mode check @zeroliu
- #1303 Fix Azure OpenAI Instance Name not used for URL @tacticsiege

---

# Release v2.8.6

- Copilot Chat now has a collapsible block for the thought process of thinking models! 🔥
- Copilot Plus can answer questions about your **vault structure** starting from this release!
- A new UI for QA inclusion/exclusion filters. It helps avoid malformed inputs and provides a more streamlined experience.
- Copilot Plus should work on Android devices without issue now!

### Improvements

- #1266 Add support for rendering `<think>` sections and fix RAG with reasoning models @logancyang
- #1249 Implement getFileTree intent @wenzhengjiang
- #1261 Enhance inclusion/exclusion patterns settings @zeroliu
- #1264 Optimize the style of model item display. @Emt-lin

### Bug Fixes

- #1275 Refactor note reference and fix dupe title issue @logancyang
- #1274 Show Vault Too Large notice @logancyang
- #1273 Refresh index should reindex files missing embeddings @logancyang
- #1272 Fix Azure OpenAI chat model @logancyang
- #1262 Remove language-specific prompt in command prompts @zeroliu
- #1260 Fix the issue of the safeFetch method not work on Android. @Emt-lin
- #1254 Fix the provider that requires verification. @Emt-lin

---

# Release v2.8.5

OpenAI O1-mini and O3-mini are added as built-in models! 🔥 You can add other O series models with "OpenAI" provider as well (Please confirm your tier with OpenAI and check if you have access to their O series API).

And we have a much better model table in the setting where you can add your own "display name" to your model, mark their capabilities "vision", "reasoning", "websearch", and drag-and-drop reorder them as you like! Thanks to @Emt-lin for the implementation!

## ⚠️ Announcement for Believers

For those who used `copilot-plus-large` to index their vault must do a force re-index to keep it working. We found the provider unstable so we switched to another provider. As the product matures there won't be such changes anymore. Sorry for the disruption 🙏

### Improvements

- #1225 Support custom model displayNames and reorderable Model list. @Emt-lin
- #1232 Adding support for Mistral as an LLM provider @o-mikhailovskii
- #1240 Add configurable batch size, update embedding requests per min @logancyang
- #1239 Add ModelCapability enum and capability detection @logancyang
- #1223 feat: update Gemini model names to v2.0 @anpigon
- #1238 Add openai o-series support @logancyang
- #1220 refactor: Improve source links formatting and rendering. @iinkov
- #1207 refactor: optimize the switching experience of the model. @Emt-lin
- #1242 Reduce binary size @zeroliu

### Bug Fixes

- #1243 Fixed apikey not switching in custom model form @Emt-lin
- #1245 Remove custom base URL fallback in YouTube transcript retrieval @logancyang
- #1237 Update copilot-plus-large @logancyang
- #1227 Fix max tokens passing @logancyang
- #1226 fix: Handle undefined activeEmbeddingModels in settings sanitization @logancyang

---

# Release v2.8.4

Gemini 2.0 Flash is fresh out of the oven, and our copilot-plus-flash is using it! Covered by your license key! 🔥

### Improvements

- #1153 Use [title](app://obsidian.md/url) format for note titles @iinkov
- #1045 Some user experience optimizations @Emt-lin

### Hot Fixes

- #1206 Add believer exclusive model copilot-plus-large @logancyang
- #1205 Fix button focus color @zeroliu
- #1204 Do not trigger reindexing with matching index. Reenable plus welcome dialog @zeroliu
- #1203 Disable welcome modal @zeroliu
- #1197 Fix non-string tag crashing issue @zeroliu
- #1202 Stop waiting for license check onload @zeroliu

---

# Release v2.8.3

Our FIRST Plus chat model is here!! 🔥🔥🔥 `copilot-plus-flash` covered by your plus license key. Now, we have a plus chat model and 3 plus-exclusive embedding models available, a truly work-out-of-box experience without the need to bring your own API key! 🚀

### Improvements

- #1150 Add Copilot Plus Flash model for Plus users @logancyang
- #1194 Show newest version at the top of settings @logancyang
- #1193 Implement PDF cache @logancyang
- #1160 Improve Plus user onboarding @zeroliu
- #1157 Add fallback mechanism for YouTube transcript retrieval @logancyang
- #1154 Debounce settings input @zeroliu
- #1151 Catch and show invalid license key error @logancyang
- #1145 Improve test cases for time range @wenzhengjiang
- #1122 Attach plugin version to request headers @wenzhengjiang

### Bug Fixes

- #1148 Avoid full vault scan on incremental indexing @zeroliu
- #1133 Fix UI issues with the textArea component @Emt-lin
- #1125 Fix button color @zeroliu
- #1145 Improve test cases for time range @wenzhengjiang
- #1151 Catch and show invalid license key error @logancyang

---

# Release v2.8.2

Enjoy much better image support! Now you can copy and paste images into the chat input in plus mode! And web images are also passed to the model if you include the URLs. A SOTA embedding model `copilot-plus-large` is added for plus users!

And note that the web search endpoint has been updated, please update to v2.8.2, or your web search `@web` won't work!

### Improvements

- #1116 Support different kinds of images (web url, local) @logancyang
- #1115 Enable image input for gemini flash 2.0 @logancyang
- #1095 Support copy-paste image @zeroliu
- #1107 Add copilot-plus-large embedding model @logancyang
- #1105 Update websearch endpoint @logancyang
- #1104 Update prompts for Copilot commands @logancyang
- #1096 Add file path to context suggestion @zeroliu

### Bug Fixes

- #1108 Fix user message formatting and wrap codeblock for long lines @logancyang
- #1106 Add time tool tests @logancyang

---

# Release v2.8.1

Chat UI revamp as we move towards a more extensible design to clear the way for more features in the next iterations! Drag-and-drop images to chat input for Plus mode!

### Improvements

- #1074 Chat UI revamp @zeroliu
- #1085 Support drag-and-drop image @zeroliu
- #1059 Add support for customizable conversation filenames @Emt-lin
- #1076 Optimize Embedding model setting UX @Emt-lin
- #1055 Remove old settings UI @Emt-lin
- #1077 Update local copilot instructions for macOS @joshmedeski

### Bug Fixes

- #1090 Fix onboarding db issue and more @logancyang
  - Some new users reported that they see "fatal error" index doesn't exist, this should be fixed now. Just make sure you switch embedding model to openai and provide the openai API key!
  - "Edit custom prompt" command was lost in 2.8.0 but it's back now!
- #1093 Update default conversation filename @logancyang
- #1091 Update settings @logancyang
- #1081 Fix time expressions @logancyang

---

# Release v2.8.0

Another massive update as we are fast approaching the official launch of Copilot Plus!! Completely revamped new Settings page with multiple tabs, a new inline editing experience with Copilot commands! You can also find some handy Copilot commands in your right-click menu!

### Improvements

- #955 New Settings UI @Emt-lin
  <img width="600" alt="SCR-20250115-qqfz" src="https://github.com/user-attachments/assets/3868b56c-38bd-4518-9009-772599ad21b7" />

- #1006 Include context in posted user message @zeroliu
  <img width="600" alt="SCR-20250115-qqsz" src="https://github.com/user-attachments/assets/0478d102-1c32-4523-9507-2cac4e5ee308" />

- #1039 Add inline edit dialog @zeroliu
  <img width="600" alt="SCR-20250115-qqkf" src="https://github.com/user-attachments/assets/9f65e417-4847-4d63-8e83-a2ac5ed2f588" />

- #1051 Bump max sources for chunks to 128 @logancyang

### Bug Fixes

- #1053 Show invalid license key only at 403 @logancyang
- #1052 Fix web image display @logancyang
- #1037 Fix youtube tool call @zeroliu
- #1035 Enforce deps check @zeroliu
- #1034 Fix cross platform encryption @logancyang
  - If you find your API key not working across desktop and mobile, please re-enter them this time. They should be working cross-platform in the future!

---

# Release v2.7.15

Further address the performance issue in Relevant Notes, and show image and clickable note links in AI response. NaN scores from vault search are handled through reranking.

### Improvements

- #1018 Use reranking on NaN chunks @logancyang
- #1017 Handle note and image links in AI response @logancyang
- #1014 Enable react eslint @zeroliu

### Bug Fixes

- #1013 Improve relevant note performance @zeroliu
- #1015 Listen to active note changes @zeroliu
- #1016 Handle NaN scores @logancyang

---

# Release v2.7.14

This is a quick one to address the performance issue in Relevant Notes, and add a new copilot-plus-multilingual embedding model for Plus users

### Improvements

- #1001 Add copilot plus multilingual embedding model @logancyang
  - This enhancement introduces a multilingual embedding model to improve the versatility and accuracy of the copilot's suggestions across different languages.
- #998 Throttle number of links returned @zeroliu
  - This fix addresses the issue of excessive link returns, optimizing the performance and relevance of the links provided by the copilot.

---

# Release v2.7.13

HUGE first release in 2025, a New Year gift for all Copilot users - introducing **Relevant Notes in Copilot Chat**! You can now see the collapsible **Relevant Notes** section at the top of the chat UI. It uses the same Copilot index you create for Vault QA. "Relevance" is determined by Copilot's own special algorithm, not just vector similarity. The entire feature is developed by our great @zeroliu, one of our top contributors 💪. Enjoy!

### Improvements

- #981 Relevant note new UI @zeroliu, a huge milestone for the Copilot plugin 🚀
- #989 Inspect index @logancyang, new command "Inspect Copilot index by note paths" to check the actual index JSON entries.
- #979 Clean up function args @zeroliu
- #980 Update tailwind color config @zeroliu

### Bug Fixes

- #996 Fix large input scroll @logancyang
- #988 Fix tags in indexing filter @logancyang

---

# Release v2.7.12

- Fix a critical issue in the index partitioning logic.
- Disable auto version check for now.

---

# Release v2.7.11

Happy holidays everyone! Thanks for your support in 2024! The highlight of this update is a MUCH faster indexing process with batch embedding, and a strong (stronger than openai embedding large) but small embedding model exclusive for Plus users called `copilot-plus-small`, it just works with a Plus license key! Let me know how it goes!

## Improvements

- #969 Enable batch embedding and add experimental `copilot-plus-small` embedding model for Plus users @logancyang
- #964 Increase the number of partitions. Skip empty files during indexing @logancyang
- #958 Update system prompt to better treat user language and latex equations @logancyang

## Bug Fixes

- #961 Fix Radix portal @zeroliu
- #967 Fix lost embeddings critical bug @logancyang
- #952 Add a small delay to avoid race conditions @logancyang

---

# Release v2.7.10

**A BIG update incoming!**

- A more robust indexing module is introduced. Partitioned indexing can handle extremely large vaults now!
- LM Studio has been added as an embedding provider, it's lightning-fast!
- A "Verify Connection" button is added when you add a Custom Model, so you can check if it works before you add it! (This was first implemented by @Emt-lin, updated by @logancyang)

Check out the details below!

# Improvements

- Big upgrade of indexing logic to have a more robust UX
- Enable incremental indexing. Now "refresh index" respects inclusion/exclusion filters
- Implement partitioning logic for large vaults
  <img width="600" alt="SCR-20241219-ocfs" src="https://github.com/user-attachments/assets/4185364a-bc02-4ff5-9ee4-745c04875b1a" />

- Inclusion filters no longer eclipses exclusion filters.
- Add Stop indexing button
  <img width="250" alt="SCR-20241219-ocmt" src="https://github.com/user-attachments/assets/6b9637a2-a26c-46a5-855f-43d3217c0fd7" />

- Add the "Remove files from Copilot index" command that takes in the same list format from "List indexed files"
  <img width="450" alt="SCR-20241219-ocud" src="https://github.com/user-attachments/assets/6f29a7b6-28d7-40f1-aadd-96057acff9e6" />

- Add confirmation modal for actions in settings that lead to reindexing
  <img width="450" alt="SCR-20241219-ocxs" src="https://github.com/user-attachments/assets/55c38dfc-f05f-4fc1-b8c0-5269bde4de40" />

- Add LM Studio to embedding providers
  <img width="500" alt="SCR-20241219-odeh" src="https://github.com/user-attachments/assets/b3115e4d-1c42-495e-a5b5-508dc2a6430b" />

- Add **Verify Connection** button for adding custom models.
  <img width="500" alt="SCR-20241219-odhv" src="https://github.com/user-attachments/assets/74fc539a-ee65-420d-a9cb-1ea2796d6e59" />

- Update the max sources setting to 30 per user request. Be warned: a large number of sources may lead to bad answer quality with weaker chat models
  <img width="600" alt="SCR-20241219-odph" src="https://github.com/user-attachments/assets/99b181ca-b71d-4ee4-a8e6-f0ff6d45c9a4" />

- Add metadata to context, now you can directly ask "what files did i create/modified in (time period)"

# Bug Fixes

- Fix safeFetch for 3rd party API with CORS on, including moonshot API and perplexity API, etc.
- Fix time-based queries for some special cases

---

# [Plus] Quick Fixes

- Enhance vault search with current time info
- Fix file already exists error for list indexed files
- Fix web search request (safeFetch GET)

---

# Improvements

- #916 Refresh VectorStoreManager at setting changes @logancyang

# Bug fixes

- #918 Brevilabs CORS issue @logancyang
- #917 Clear chat context on new chat @logancyang

---

# Improvements

- #908 Add setting to exclude copilot index in obsidian sync @logancyang
- #906 Update current note in context at change @logancyang

# Bug fixes

- #913 Validate or invalidate current model when api key is updated @logancyang
- #912 Fix Index not loaded, add better index checks for a fresh install @logancyang
- #911 Avoid using jotai default store @zeroliu

---

## Critical Bug Fix

- #893 New users could not load the plugin @logancyang

---

# Release v2.7.5

Great news, no more "Save and Reload" thanks to @zeroliu ! Settings now save automatically! 🚀🚀🚀

## Improvements

- #890 Implement indexing checkpointing @logancyang
- #886 UX improvements (Fix long titles in context menu, chat error as AI response, etc.) @logancyang
- #882 Add user message shade @logancyang
- #881 Copilot command: list all indexed files in a markdown note @logancyang
- #874 Auto save settings @zeroliu
  - Settings now automatically save after changes without requiring manual save and reload!!
- #872 Add New chat confirm modal, restructure components dir @logancyang
- #851 Support certain providers to customize the base URL @Emt-lin
- #850 Fix system message handling for o1-xx models, convert systemMessage to aiMessage for compatibility @Emt-lin
- #880 Append user system prompt instead of override @logancyang

## Bug fixes

- #846 Fix disappearing note in context menu @logancyang
- #845 Make open window command focus active view @zeroliu
- #887 Fix note cannot be removed bug @logancyang
- #873 Fixed URL mention behavior in Chat mode @logancyang

---

# Improvements

- #824 Improve settings and chat focus @zeroliu
- #843 Implement Copilot command "list indexed files" @logancyang

# Bug fixes

- #842 Fix system message for non-openai models @logancyang
- #843 Alpha quick fixes @logancyang
  - Fix message edit
  - Unblock saveDB
  - Skip rerank call if max score is 0
  - Fix double indexing trigger at mode switch

---

# Improvements

Copilot Plus Alpha is here! I've been working on this for a long time! Test license key is on its way to project sponsors and early supporters.

- **Time-based Queries**: Ask questions like `Give me a recap of last week @vault` or `List all highlights from my daily notes in Oct @vault`. Copilot Plus understands time!
- **Cursor-like Context Menu**: Enjoy a more intuitive and streamlined context menu specifically designed for Plus Mode. It not only shows note titles but also PDF files and URLs!
- **URL Mention Capability**: Quickly reference URLs in your chat input. Copilot Plus can grab the webpage in the background!
- **Vault Search with Cmd + Shift + Enter**: Search your vault with a simple keyboard shortcut, this is equivalent to having `@vault` in your query.
- **Dynamic Note Reindexing**: Copilot index is updated at note modify event under Copilot Plus mode (this is not the case in Vault QA basic mode), ensuring your data is always up-to-date.
- **Image Support in Chat**: Add and send image(s) in your chat for any LLMs with vision support.
- **PDF Integration in Chat Context**: Easily incorporate PDF file or notes with embedded PDF in your chat context.
- **Web Search Functionality**: Access the web directly from your Copilot Plus Mode with `@web`.
- **YouTube Transcript**: Easy access to video transcript with `@youtube video_url` in chat.

<img width="788" alt="SCR-20241122-pqqv" src="https://github.com/user-attachments/assets/3092ac2d-c92f-4b98-ad8a-4fb1cfaddda6">
<img width="789" alt="SCR-20241122-pqyk" src="https://github.com/user-attachments/assets/a337d05c-4f63-48ca-b261-63e3228b6f08">

- #839 Add Copilot Plus suggested prompts @logancyang
- #838 Return YouTube transcript directly without LLM for long transcripts @logancyang
- #835 Introduce Copilot Plus Alpha to testers @logancyang

# Bug fixes

- #826 Fix delete message in memory @logancyang
- #825 Fix "index not loaded" @logancyang
- #812 Fix model and mode menu side offset @logancyang

---

## Improvements

- Implement Cursor style chat input @logancyang
  <img width="764" alt="SCR-20241113-mxog" src="https://github.com/user-attachments/assets/c14786fa-d825-4204-b5c4-cabeb0680147">

- Add setting to optionally disable index loading on mobile to save resources @logancyang
  <img width="834" alt="SCR-20241113-mycf" src="https://github.com/user-attachments/assets/c1b24080-ffb8-491d-9ff2-3b29938b7690">

- Add default open area settings @zeroliu
  <img width="233" alt="SCR-20241113-mxvc" src="https://github.com/user-attachments/assets/4f3060d7-f0ce-48eb-9c54-c617e3660fbc">

- Use Lucide icons to replace custom SVG icons @zeroliu
- Refactor chat control tooltips @zeroliu
- Sample 2 vault QA prompts for vault QA mode without replacement @logancyang

## Bug fixes

- Fix suggested prompts responsiveness @zeroliu
- Fix upsert error @logancyang

---

## Improvements

- #774 Optimize model setting style for mobile devices @Emt-lin 🚀
  <img width="250" alt="SCR-20241105-mrkz" src="https://github.com/user-attachments/assets/f17eae11-c2d0-475c-a70a-96a5c8c91f79">

- #768 Add suggested prompts @zeroliu 🎉
  <img width="500" alt="SCR-20241105-mpvu" src="https://github.com/user-attachments/assets/a3dbb60f-7333-4aa8-8212-84a1626db77f">

- #777 Implement QA Inclusions filter @logancyang
  <img width="800" alt="SCR-20241105-mthk" src="https://github.com/user-attachments/assets/0bb4bd8e-1696-42ee-baa0-06a02b8bb70a">

- #750 Allow entering [[ anywhere in the prompt @zeroliu
- #778 Avoid Gemini SAFETY blocks @logancyang

## Bug fixes

- #781 Fix garbage collection command @logancyang
- #779 Fix Ollama embedding context length with truncation @logancyang
- Fix issue where user's setting exclusion files are not excluded when calculating tokens @Emt-lin

---

# Improvements

- #723 Support exclude files from indexing by name pattern @Emt-lin
- #706 Add default mode in settings so it keeps your mode selection
- #702 Migrate from PouchDB to Orama.
  - Now we don't have any dependency that blocks mobile!
  - Your new index file is at `.obsidian/copilot-index-<hash>.json`
- Remove Long Note QA mode and Send Note(s) to Prompt button in Chat mode since they are legacy features that are covered by new experience: Vault QA with note title mention, slash command and templating

# Bug fixes

- #707
- #699

---

# Release v2.6.11

Indexing improvements

- Added rate limiting in settings, and 429 notice banner
  <img width="738" alt="SCR-20241003-nwcs" src="https://github.com/user-attachments/assets/511cb9a5-85d2-4ba5-b423-289fb94d0dee">
  <img width="349" alt="SCR-20241002-tipa" src="https://github.com/user-attachments/assets/b53aa275-0b37-4408-9406-92a2d02d5452">

- Added button for pausing and resuming indexing that also shows the exclusion setting
  <img width="328" alt="SCR-20241002-tihp" src="https://github.com/user-attachments/assets/72aeb586-0353-4a9c-ad3f-05c12adef8f7">

- Added support for exclusion by tags (must be in note property, not the content body, similar to how custom prompt templating works)
  <img width="857" alt="SCR-20241003-njcg" src="https://github.com/user-attachments/assets/2716e789-62c1-4de1-b61b-1ac5c1d4909f">

---

# Release v2.6.10

Improved QA in this release! Significant upgrades to Vault QA mode coming soon.

- Implement HyDE for Vault QA mode #645
- Add Google embedding model and update langchain https://github.com/logancyang/obsidian-copilot/pull/651 by @o-mikhailovskii
- Bug fixes
  - System prompt in QA modes #692
  - Fix new chat not stopping streaming @Emt-lin
  - Fix language identification for changing tone command @Emt-lin
  - Fix AI message wrapping

---

# Release v2.6.9

- @Emt-lin: enable Perplexity API with CORS on https://github.com/logancyang/obsidian-copilot/pull/673. Related issues:
  - #424
  - #431
  - #661
- Fixes #670
- Internal improvement: pass note to LLM in md format
- Fixes #663

---

# Release v2.6.8

- Had to put in a quick bug fix #667
- Implement Delete button for every message #668
  <img width="703" alt="SCR-20240923-twtg" src="https://github.com/user-attachments/assets/b23ba483-79b3-454d-8738-efb2aa994939">

---

# Release v2.6.7

- #665 Messages now have timestamps! Saved conversations have timestamps too.

  - A saved conversation uses its first message's timestamp
  - The loading conversations modal now sorts the chat history in descending order.
    <img width="718" alt="SCR-20240923-ppqq" src="https://github.com/user-attachments/assets/5b93662c-fa92-47da-912e-db550d1ce91c">

- #656 @Emt-lin now our custom prompts are sorted with most recently used first
- #659 @logicsec we can tag saved conversations in Copilot setting
- Bug fix for mobile not loading

---

# Release v2.6.6

Some UX improvements

- Enable renaming of custom prompt in Edit Custom Prompt command modal https://github.com/logancyang/obsidian-copilot/pull/635
- Revert auto-scroll as it streams behavior to scroll to bottom only when streaming is done, avoid jittery auto-scrolling, and fix up and down arrow key navigation for some corner cases https://github.com/logancyang/obsidian-copilot/pull/632
- Fix a bug where cursor is not focused in chat input when Copilot Chat pane is toggled on https://github.com/logancyang/obsidian-copilot/pull/593

Welcome first-time contributor @Emt-lin

---

# Release v2.6.5

Another big one!

<img width="580" alt="SCR-20240909-ssvc" src="https://github.com/user-attachments/assets/02693aea-95ab-42a2-bdfa-e645f4f682e9">

- Custom prompt template support in Chat!! Now you can just type `/` and bring up the list of custom prompts you have. Selecting one fills it into the chat input box!
- `{activeNote}` added to custom prompt template! Many people have been asking for this.
- Up and down arrow keys now navigate your user messages! (not persisted, clears at reload)
- Cohere API setting now in API settings section instead of QA settings, because we have Command R and R+ as builtin chat models!
- Some UX improvements
  - When autosave for conversation is on, saved convo doesn't open at plugin reloads, a notice banner shows up instead.
  - When deleting a default model, the default is reset to gpt-4o, the "grand default".

# PRs

- #619
- #620
- #621
- #626
- #629

---

# Release v2.6.4

Bug fixes

- #608
- #609
- Cohere embedding model name issue
- Add custom prompt without folder created
- Update local copilot guide for new settings

---

# ALERT

We are migrating off of PouchDB for better Obsidian Sync and mobile support. In this release, your existing custom prompts must be dumped to markdown using the command "Copilot: Dump custom prompts to markdown files". After running it you should be able to use your Add/Edit/Apply/Delete custom prompts as usual.

Please make sure you run it, or you will lose all your old prompts when PouchDB is removed!

# New Features

- Load Copilot Chat conversation via new command "Copilot: Load Copilot Chat conversation".
- New setting toggle for chat autosave, automatically save your chat whenever you click new chat or reload the plugin.
- Custom prompts saved in markdown

# Bug Fixes

A self-hosted Ollama issue. #598

# PRs

- #600
- #602
- #604

---

# Release v2.6.2

Implemented new chat buttons, now:

- User has Copy, Edit
- AI has Copy, Insert to note at cursor, Regenerate

Note that editing user message will trigger regenerate automatically when done.

<img width="677" alt="SCR-20240904-sqls" src="https://github.com/user-attachments/assets/1b21ab3a-1b00-4bed-abbf-fb085892a7bc">

And bug fixes.

- #585
- #586
- #588
- #594

---

# Release v2.6.1

Quick bug fixes

- #581
- #582

---

# Release v2.6.0

- Huge thanks to our awesome [@gianluca-venturini](https://github.com/gianluca-venturini) for his incredible work on mobile support! Now you can use Copilot on your phone and tablet! 🎉🎉🎉

- Complete rehaul of how models work in Copilot settings. Now you can add any model to your model picker provided its name, model provider, API key and base url! No more waiting for me to add new models!
  <img width="798" alt="SCR-20240827-mwpm" src="https://github.com/user-attachments/assets/19bb1883-cde8-46e4-8656-0c886d4d032f">
  <img width="779" alt="SCR-20240831-peid" src="https://github.com/user-attachments/assets/832c254e-2e7c-44c6-90f4-2722cd154e76">

- Say goodbye to CORS errors for both chat models and embedding! The new model table in settings now lets you turn on "CORS" for individual chat models if you see CORS issue with them.
  - Embedding models are immune to CORS errors by default!
  - Caveat: this is powered by Obsidian API's `requestUrl` which does not support "streaming" of LLM responses. So streaming is disabled whenever you have CORS on in Copilot settings. Please upvote [this feature request](https://forum.obsidian.md/t/support-streaming-the-request-and-requesturl-response-body/87381) to let Obsidian know your need for streaming!

---

# Release v2.5.5

Another long-awaited major update: message styling revamp, plus math and code syntax highlighting support! 🎉🎉🎉
<img width="1107" alt="SCR-20240824-uddc" src="https://github.com/user-attachments/assets/3ab99187-27cd-4eea-ad67-693abc1a2209">
<img width="1103" alt="SCR-20240824-udgm" src="https://github.com/user-attachments/assets/6f33f442-fc1e-4bd0-b981-665588437f8f">

- Now the messages are more compact and clean, with better math, code and table support.
- The Send button turns to Stop button when it's streaming, old Stop button is gone.
- Some housekeeping and minor tweaks
  - Refactored Settings components
  - Added prettier and husky for formatting pre-commit hook
  - Show default system prompt as placeholder for better visibility
  - Bug fix: find notes by path corner case
  - Community contribution: @pontabi 's first ever PR, aligns Copy button at the bottom right of messages

---

# Release v2.5.4

We have some awesome updates this time!

- No more CORS errors for any OpenAI replacement API! Now you can use any 3rd party OpenAI replacement without CORS issue with the new toggle in Advanced settings. Big thanks to @Ebonsignori! #495
  <img width="417" alt="SCR-20240810-ksva" src="https://github.com/user-attachments/assets/9a300a6b-9a7f-4117-be70-1c87f9ee3d1a">

- GEMINI 1.5 PRO and GEMINI 1.5 FLASH added! Thanks to @anpigon #497
  <img width="198" alt="SCR-20240810-ktrb" src="https://github.com/user-attachments/assets/7154d95c-4cce-4452-8481-4c9e5ad32d55">

- Custom model fields added for OpenAI and Google. Note that when OpenAI proxy base URL is present, the override logic is: proxy model name > custom model name (this addition) > model dropdown. #499
  <img width="510" alt="SCR-20240810-ktwk" src="https://github.com/user-attachments/assets/e154a367-75e4-4f59-8324-ac9aa5d2bdd1">
  <img width="491" alt="SCR-20240810-ktxf" src="https://github.com/user-attachments/assets/e444cf41-50e1-4245-b9b0-6653587e50cf">

- Add setting to turn built-in Copilot commands on and off to reduce command menu clutter #500
  <img width="400" alt="SCR-20240810-kuxz" src="https://github.com/user-attachments/assets/033b41c6-bff4-4679-ae38-3c929438fa50">

- Fix 2 long time bugs where user messages are duplicated in saved note, and custom prompt commands missing when note not focused #501 #502
- GPT-3 models are removed since GPT-4o-mini is superior in every way.
- When switching models, the actual model name used in the API call is shown in the Notice banner, better for debugging.

---

# Release v2.5.3

Sorry for the delay folks, I was afk for quite a while but am back now!

- GPT 4o and mini are added.
- "Claude 3" renamed to just "Claude" and defaults to the new best `claude-3-5-sonnet-20240620` model (reset or manual input required)
- Fix a bug where source link is broken when vault name has spaces
- Groq is added
- OpenAI organization id added
- Summarize Selection added to context menu
- fish cors example

Big thanks to all community contributions!! #482, #446, #445, #441, #436

---

# Release v2.5.2

- Fixed a bug where frontmatter parsing was failing
- Fix missing command https://github.com/logancyang/obsidian-copilot/issues/353
- Add exclude filter for indexing https://github.com/logancyang/obsidian-copilot/issues/334
- Implement a first iteration of the custom retriever https://github.com/logancyang/obsidian-copilot/issues/331
- Implement note title mention in Chat and Vault QA mode
  - Now if you type `[[` it will trigger a modal for a list of all note titles to pick from
  - In Chat mode, a direct `[[]]` note title mention sends the note content in the prompt in the background, similar to how custom prompts work.
  - In Vault QA mode, a direct `[[]]` note title mention ensures that the retriever puts that note at the top of the source notes

---

# Release v2.5.1

Bug fixes

- https://github.com/logancyang/obsidian-copilot/issues/347
- https://github.com/logancyang/obsidian-copilot/issues/342
- https://github.com/logancyang/obsidian-copilot/issues/332

Re-indexing for Vault QA is recommended!

---

# Release v2.5.0

- Brand new Vault QA (BETA) mode! This is a highly-anticipated feature and is a big step forward toward the vision of this plugin. Huge shoutout to @AntoineDao for working with me on this! https://github.com/logancyang/obsidian-copilot/pull/285
  - Implement more sophisticated chunking and QA flow
  - Rename current QA to Long Note QA
  - Fix Long Note QA logic
  - Add a list of clickable "Source Notes" titles below AI responses
  - Show the chunks retrieved in debug info.
  - Add command to Index Vault for QA
  - Refresh Index button
  - Add another one Force complete re-index for Vault QA
  - Add notice banner for indexing progress
  - Local embedding integration with Ollama
  - Add max sources setting
  - Add strategy ON_MODE_SWITCH, calls refresh index on mode switch
  - Add count total token of vault command, and language in settings for cost estimation.
- Claude 3 integration. You can set the actual Claude 3 model variant in the setting. Default is `claude-3-sonnet-20240229`

---

# Release v2.4.18

- Fix a bug where chat context is not set correctly @Lisandra-dev https://github.com/logancyang/obsidian-copilot/pull/304
- Enable model name, embedding provider url, embedding model name overrides for various OpenAI drop-in replacement providers like one-api etc. https://github.com/logancyang/obsidian-copilot/pull/305
- Add encryption for API keys https://github.com/logancyang/obsidian-copilot/pull/306
- Update Ollama context window setting instruction https://github.com/logancyang/obsidian-copilot/pull/307

---

# Release v2.4.17

- Add filter notes by tags in "Set note context in Chat mode" command https://github.com/logancyang/obsidian-copilot/pull/291
- Add filter notes by tags in Advanced Custom Prompt https://github.com/logancyang/obsidian-copilot/pull/296
- (Chore) Remove all the different Azure model choices and leave one AZURE OPENAI to avoid confusion. The actual Azure model is set in the settings.
- Fix a bug where model switch fails after copilot commands https://github.com/logancyang/obsidian-copilot/pull/298

<img width="598" alt="SCR-20240213-ugbm" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/84a421c0-8952-48ad-86df-7e7f19160873">

<img width="585" alt="SCR-20240216-nsht" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/fc36dcbc-2990-4d37-b805-c4b7217db5ba">

---

# Release v2.4.16

- Introducing advanced custom prompt! Now custom prompts don't require a text selection, and you can compose long and complex prompts by referencing a note or a folder of notes! https://github.com/logancyang/obsidian-copilot/pull/281
  <img width="500" alt="SCR-20240206-lvsy" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/a4c9247c-f1ed-4fc9-b248-529fd31fc41f">

- Enable setting the full LM Studio URL instead of just the port https://github.com/logancyang/obsidian-copilot/pull/283
  <img width="698" alt="SCR-20240206-lwbg" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/c6092d92-58ee-40ae-9bfc-dc4169ffd2fa">

---

# Release v2.4.15

- Allow sending multiple notes to the prompt with one click in Chat mode! You can specify the note context using the new Copilot command `Set note context for Chat mode` https://github.com/logancyang/obsidian-copilot/pull/265
- Add ad-hoc custom prompt for selection. Thanks to @SeardnaSchmid https://github.com/logancyang/obsidian-copilot/pull/264

---

# Release v2.4.14

Bug fixes

- Only init embedding manager when switching to QA mode
- Avoid OpenAI key error when it's empty but the model or embedding provider is not set as OpenAI
- Add back Azure embedding deployment name setting

---

# Release v2.4.13

- Add the new OpenAI models announced today
- 2 new embedding models small and large. Small is better than ada v2 but 1/5 the cost! Large is slightly more expensive than the old ada v2 but has much better quality.

  - Now you can set them in the QA settings section
    <img width="467" alt="SCR-20240125-pqya" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/6a349236-35c4-45d4-98dc-3952ad080915">

- New `gpt-4-turbo-preview` alias that's pointing to `gpt-4-0125-preview`, and new `gpt-3.5-turbo-0125` (already covered by alias `gpt-3.5-turbo`.
- For more details check the [OpenAI announcement page](https://openai.com/blog/new-embedding-models-and-api-updates)

---

# Release v2.4.12

- Use LCEL for both Chat and QA chains, and use multi-query retriever to increase recall
- Add running dots indicator when loading AI messages since conversational QA with LCEL and multi-query retriever is a bit slower. Show the user it's not stuck, just loading
  <img width="550" alt="SCR-20240124-odxf" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/934f3236-75bc-44eb-9b44-c4f6daa0b749">

---

# Release v2.4.11

- Implement new Copilot settings components
- Add custom Ollama base URL
  <img width="745" alt="SCR-20240120-qshf" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/80876f86-0740-4325-90cd-07624f386d96">
  <img width="749" alt="SCR-20240120-qsir" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/5e2ffd64-4d33-4690-9ea9-3c9817207630">
  <img width="736" alt="SCR-20240120-qsjx" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/889162f4-3c39-4e76-97d5-980c47b7bf71">
  <img width="729" alt="SCR-20240120-qskz" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/cd7e45a6-45bc-46ed-ac3c-9d6653c35899">
  <img width="737" alt="SCR-20240120-qslx" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/4068f0fb-6fd3-4ba2-8994-64ec3d8cd9f2">

---

# Release v2.4.10

- Change `Conversation` mode to `Chat` mode, and `QA: Active Note` to just `QA` to prepare for **QA over the whole vault** mode.
- Add a button to send the active note directly into the prompt in Chat mode. This button shows only in Chat mode, and it becomes the index button in QA mode.
  ![chat-note-prompt](https://user-images.githubusercontent.com/4860545/297923242-b9108634-300a-4f1d-b428-ddf626bedad9.gif)

---

# Release v2.4.9

- Add OpenRouterAI as a separate option in model dropdown. You can specify the actual model in the setting. OpenRouter serves free and uncensored LLMs! Visit their site to check the models available https://openrouter.ai/
  <img width="590" alt="SCR-20240112-ifwi" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/6f2fb27c-ab7a-4515-aefb-faf827b1a2d1">
  <img width="790" alt="SCR-20240112-igae" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/3fd95b69-61b8-46b8-bad7-e8a8c1d81c65">

- Bumped max tokens to 10000, and max conversation turns to 30

---

# Release v2.4.8

- Add LM Studio and Ollama as two separate options in the model dropdown
- Add [setup guide](https://github.com/logancyang/obsidian-copilot/blob/master/local_copilot.md)
- Remove LocalAI option

---

# Release v2.4.7

- Add google api key in settings

<img width="719" alt="Screenshot 2024-01-07 at 7 22 34 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/7dd42902-2cfd-4267-9ef0-2cf45072c42e">

- Add Gemini Pro model

  - I find that this model hallucinates quite a lot if you have a high temperature. Set the temperature close to 0 for better results.

    - Temperature 0.7:
      <img width="554" alt="Screenshot 2024-01-07 at 7 19 27 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/9a89951a-e793-4eeb-bf3d-10b0c6e8c96c">
      <img width="727" alt="Screenshot 2024-01-07 at 7 19 38 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/e414ab91-027e-4de7-9be7-a30f4402ab7e">

    - Temperature 0.1:
      <img width="561" alt="Screenshot 2024-01-07 at 7 23 17 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/2f5070b7-527d-423a-9a73-f7f8ed97e559">

---

# Release v2.4.6

- Add Save and Reload button to avoid manually toggling the plugin on and off every time settings change. Now, clicking on either button triggers a plugin reload to let the new settings take effect
  <img width="750" alt="Screenshot 2024-01-01 at 9 59 50 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/7f5b8737-4f38-4df4-8508-0d4788943c32">

- Fix error handling
  - No more "model_not_found" when the user has no access to the model, now it explicitly says you have no access
  - Shows the missing API key message when the chat model is not properly initialized
  - Shows model switch failure when Azure credentials are not provided
- Show the actual model name and chain type used in debug messages
- Make `gpt-4-turbo` the default model

---

# Release v2.4.5

- Upgraded langchainJS to v0.0.212
- Fix bugs and UX issues
  - IME for east Asian languages now does not send on Enter
  - OpenAI proxy base URL also overrides for the embedding model https://github.com/logancyang/obsidian-copilot/issues/211
  - Clearing vector store should not affect new instance creation

---

# Release v2.4.4

- Add the new shiny GPT-4 TURBO model that has 128K context length! (I noticed that this new model is now very fast and the older ones including GPT-3 are becoming slower. Not sure if it's just me. Let me know if this happens to you too!)

---

# Release v2.4.3

- Add default folder for saved conversations
  <img width="727" alt="Screenshot 2023-08-14 at 4 21 13 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/84de47cf-940e-454b-b0a7-661a55e2ee89">

---

# Release v2.4.2

- Implement cross-session local vector store using PouchDB
- Add a command to clear the local vector store
  <img width="623" alt="Screenshot 2023-08-10 at 4 57 06 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/67debd22-e836-4701-93f8-a53d6a7525be">

- Add TTL setting and doc removal at plugin load time
  <img width="720" alt="Screenshot 2023-08-10 at 4 56 15 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/23fa9100-a965-477d-8dc1-ed040af5c024">

---

# Release v2.4.1

- Thanks to @Sokole1's contribution, Local Copilot does not need a proxy server and can just use the OpenAI Proxy Base URL setting. Pls check the [updated setup guide](https://github.com/logancyang/obsidian-copilot/blob/master/localai_setup.md)!

---

# Release v2.4.0

- Add proxy server for LocalAI
- Implement local model access
- Add LocalAI as an embedding provider
- Add a [step-by-step guide](https://github.com/logancyang/obsidian-copilot/blob/master/localai_setup.md) for LocalAI setup for Apple Silicon and Windows WSL
- Created [youtube demo video](https://www.youtube.com/watch?v=3yPVDI8wZcI) for v2.4.0

---

# Release v2.3.6

- Add support for 3rd party OpenAI proxy (mainly for users who cannot access OpenAI directly) https://github.com/logancyang/obsidian-copilot/pull/113
  <img width="792" alt="Screenshot 2023-07-19 at 6 13 24 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/2dbc14b0-103a-4b95-ab46-cd140989d072">

---

# Release v2.3.5

- Add command "Toggle Copilot Chat Window in Note Area" to toggle the Chat UI in the main note area. Good for consumption with smaller screens. https://github.com/logancyang/obsidian-copilot/issues/102, https://github.com/logancyang/obsidian-copilot/issues/5

<img width="1575" alt="Screenshot 2023-07-13 at 3 45 50 PM" src="https://github.com/logancyang/obsidian-copilot/assets/4860545/78511cf0-6877-4595-a592-aa9d454ee716">

---

# Release v2.3.4

- Fix system prompt bug https://github.com/logancyang/obsidian-copilot/issues/104
- Set AI chat font size using global font size setting in Obsidian. The chat font is always 2px smaller than the global font size. https://github.com/logancyang/obsidian-copilot/issues/92

---

# Release v2.3.3

- Fix Stop Streaming in QA mode https://github.com/logancyang/obsidian-copilot/issues/54
- Add Azure gpt35 16k https://github.com/logancyang/obsidian-copilot/issues/101
- Add Azure OpenAI as an embedding provider https://github.com/logancyang/obsidian-copilot/issues/81

---

# Release v2.3.2

- Fix default model not respected bug

---

# Release v2.3.1

- Added gpt-3.5-turbo-16k, gpt-4-32k and Azure OpenAI ones
- Force index rebuild when the button is clicked
- Add the new models to settings
- Fix UI issue where narrow chat view makes buttons inaccessible

---

# Release v2.2.4

- Add CohereAI as an embedding provider, it is FREE and stable!
- Use contextual compression retriever for QA
- Fix a bug where Rebuild Index button does not switch note context on first click

---

# Release v2.2.3

- Add "Edit custom prompt" command. Note that Title cannot be edited!
- Turn on mobile support to test it out.

---

# Release v2.2.2

Fix bug where plugin fails to load silently without OpenAI key

---

# Release v2.2.1

- Fix bug where copilot commands output in English when the source language is not English

---

# Release v2.2.0

- User custom prompt! Now you can create your own prompt as a command, the only limit is your imagination!
- To avoid confusion, the "Chain Selection" dropdown is renamed to "Mode Selection", and the "Use Active Note as Context" button is renamed to "Rebuild index for active note". It is not necessary to click this button every time before switching to "QA: Active Note" mode. And the button is moved to the right side of the dropdown.
- Local PouchDB integration to support local prompt library.

---

# Release v2.1.0

The biggest release yet!

- LangchainJS integration: allow more chain types to be used.
- In-memory vectordb powered QA, unlimited context for active note!
- Use sliders to set temperature, max token and conversation turns to avoid form input issues on different platforms.
- New token count command

---

# Release v2.0.0

- Migrate to LangChainJS to enable a lot more potential features and upgrades!

---

# Release v1.2.4

- Add flag `isVisible` to show chat messages optionally
- Fix "Use Active Note as Context" functionality

---

# Release v1.2.3

- Auto focus on the chat window's input text area when the window is toggled on
- Add user custom system prompt advanced setting
- Use toggle instead of dropdown for streaming and debugging mode settings

---

# Release v1.2.2

- Fix CSS conflicts with default styling

---

# Release v1.2.1

- Add better OpenAI error messages
- Fix typo for the "table of contents" command
- Add community plugin installation guide in readme

---

# Release v1.2.0

- Add a number of commands
  - summarization
  - eli5
  - change tone
  - fix grammar and spelling
  - generate table-of-contents
  - generate glossary
  - press release
  - make longer and shorter
  - a number of new languages in translation suggestions
- Add new dev mode setting

---

# Release v1.1.1

- Add `requestUrl` from Obsidian API for non-streaming option
- Re-implemented streaming using SSE
- Various fixes including stop streaming and new chat handling

---

# Release v1.1.0

Add new commands for selection

- Simplify
- Emojify
- Remove URLs
- Translate
- Rewrite into tweet/thread

---

# Release v1.0.2

Fix css li specificity bug that causes li marker problems in note reading mode.

---

# Release v1.0.1

Initial release.
