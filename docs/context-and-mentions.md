# Context and Mentions

Context is the material Copilot gives an AI with your request. In Copilot V4, these features have different lifetimes:

- **Agent attachments and context mentions** apply to the next message.
- **Agent mentions** ask installed agents to answer that message.
- **Project context** is saved and reused across chats in that project.
- **Quick Chat context and tools** belong to Quick Chat, not Agent.

## Add context to an Agent turn

Use the **+** button (**Add context**) beside the Agent composer. Depending on what is open, you can choose **Active Note**, **Notes**, **Folders**, **Active Web Tab**, **Web Tabs**, or **Images**. Web tabs use Copilot's desktop Web Viewer.

You can also add context while typing:

- Type `[[` and select a note. It appears as `[[Note title]]`.
- Type `@` to search the available context categories.
- Choose a folder to insert its path as `{Folder/path}`.
- Paste or drag an image into the composer, or choose **Images** from **Add context**. The selected model must support images.

Context badges above the composer show what will be sent. Remove any item with its **x** before sending. These attachments are cleared after the message is sent; they do not become permanent context for the conversation.

A note mention gives the agent the note's vault path so it can read the current file when needed. A folder mention points the agent to a folder to inspect; it does not paste every file in that folder into the prompt.

### Active note and selected text

A fresh Agent chat follows your active-note preference and may start with an **Active Note** badge. Remove the badge when the current note is unrelated, or add **Active Note** again for a later turn.

To attach an excerpt, select text in a note and run **Add selection to chat context** from the command palette. For text selected in the Web Viewer, run **Add web selection to chat context**. The excerpt appears as a removable badge and is included only with the next message. When a web selection is attached, Copilot sends the excerpt instead of also sending the full active web tab.

## Mention other agents

With active Plus access, type `@`, open **Agents**, and select installed agents. Each selected agent receives the same question and one-turn context, and the current agent summarizes their answers.

Multi-agent turns are for read-only research and review. Use a regular single-agent turn when you want files changed. Mentioning only the current agent behaves like a normal turn.

Agent does **not** expose Quick Chat's `@vault`, `@websearch`, `@composer`, or `@memory` tools. Agent uses the active backend's native tools and enabled skills instead.

## Save context in an Agent project

For context you want to reuse, open an Agent project and use its **Context** section or **Context** tab. You can drag in a vault file or folder, or choose **Manage Context** to add **Links**, **Tags**, **Properties**, **Folders**, and **Files**.

Project context is prepared for every chat in that project. If it is still loading when you send, Copilot queues the message until the context is ready. Start a new project chat after changing saved context or project instructions when you want the latest version applied.

Project context is a focus aid, not a permission boundary. The agent can still inspect other files available through its native tools, and **Ignore Files** only excludes files from prepared project context. One-turn attachments remain one-turn attachments even inside a project.

See [Agent Projects](projects.md) for supported files, hosted conversion, and privacy details.

## Context in Quick Chat

Quick Chat has its own composer and context state. It can add the active note and, on desktop, the active Web Viewer tab. Use **Add context** for a note, folder, web tab, or image. Type `@` for notes, folders, or web tabs, and `[[Note title]]` for a note. Context badges show what the next message includes. In **copilot plus**, you can also paste a URL as context and type `#` to select a vault tag for a vault-search query.

Paid Quick Chat also supports these explicit tool mentions:

| Mention      | Action                             |
| ------------ | ---------------------------------- |
| `@vault`     | Search the vault                   |
| `@websearch` | Search the web (`@web` also works) |
| `@composer`  | Create or edit a note              |
| `@memory`    | Save information to memory         |

These mentions are available in the **copilot plus** Quick Chat mode. They are not Agent mentions and do not select opencode, Claude, or Codex.

## Related

- [Agents in Copilot V4](agent-mode-and-tools.md)
- [Agent Projects](projects.md)
- [Quick Chat Interface](chat-interface.md)
