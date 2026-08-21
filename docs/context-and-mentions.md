# Context and Mentions

Context is the material Copilot gives an AI with your request. Choose the shortest lifetime that fits the job:

| Context type                     | How long it lasts                                 |
| -------------------------------- | ------------------------------------------------- |
| Agent Chat attachment or mention | The next message                                  |
| Mentioned agent                  | The current multi-agent question                  |
| Project context                  | Every new chat started in that Project            |
| Vault or Project `AGENTS.md`     | Every Agent Chat started in that vault or Project |
| Quick Chat attachment            | The next Quick Chat message                       |

## Add context to Agent Chat

Select **+** beside the Agent Chat composer to open **Add context**. Depending on what is open, you can add the **Active Note**, other **Notes**, **Folders**, the **Active Web Tab**, other **Web Tabs**, or **Images**. Web tabs come from Copilot's desktop Web Viewer.

You can also add context while typing:

- Type `[[` and select a note to insert `[[Note title]]`.
- Type `@` to browse the available context categories.
- Choose a folder to insert its path as `{Folder/path}`.
- Paste or drag an image into the composer. The selected model must support images.

Context badges above the composer show what will be sent with the next message. Select the **x** on a badge to remove it. After the message is sent, one-turn attachments are cleared.

A note mention gives the agent the note's vault path so it can read the current file when needed. A folder mention points to a folder to inspect. It does not paste every file in that folder into the prompt.

### Active note and selected text

A new Agent Chat can start with an **Active Note** badge when that preference is enabled. Remove it when the current note is unrelated. You can add it again on any later turn.

To attach an excerpt from a note:

1. Select the text.
2. Run **Add selection to chat context** from the command palette.
3. Review the removable selection badge before sending.

For text selected in the Web Viewer, run **Add web selection to chat context**. Copilot sends the selected excerpt instead of also attaching the full active web tab.

## Mention other agents

With active Plus access, type `@`, open **Agents**, and select one or more other installed agents. Each mentioned agent receives the same question, that turn's attachments, and a bounded slice of the visible conversation. The current agent summarizes their answers and does not automatically answer separately.

Multi-agent answers are designed for read-only research, second opinions, and review, but retrieval Skills can still run trusted scripts under an agent's permissions. They are not a security sandbox. Use a normal single-agent turn when you want files changed. Mentioning only the current agent behaves like a normal turn.

Agent mentions select opencode, Claude, or Codex. They are different from note, folder, and web context mentions. See [Multi-agent answers](agent-mode-and-tools.md#multi-agent-answers) for permissions and model behavior.

## Reuse context with Projects

For material that should be prepared for more than one chat, create a [Project](projects.md). Add saved context from the **Context** section or tab:

- drag in a vault file or folder;
- add a web page or YouTube URL; or
- select **Manage Context** to add links, tags, properties, folders, files, and ignored files.

Project context is prepared for every new chat in that Project. If preparation is still running when you send a message, Copilot queues the message and starts it when the context is ready.

Saved context is a focus aid, not a permission boundary. The agent can still inspect other files available through its tools. **Ignore Files** excludes files from prepared Project context but does not block an agent from reading them.

One-turn attachments remain one-turn attachments inside a Project. Start a new Project chat after changing saved context or Project instructions when you want the latest version applied.

## Context in Quick Chat

Quick Chat has a separate composer and context state. It can attach the active note and, on desktop, the active Web Viewer tab. Use **Add context** for a note, folder, web tab, or image. You can also type `[[Note title]]` for a note.

Quick Chat attachments apply to the next Quick Chat message. They do not become Agent Chat context, Project context, or `AGENTS.md` instructions.

For vault-wide semantic search and AI history that you own outside the plugin, use [Miyo](vault-search-and-indexing.md). Miyo provides the local-first search path for Copilot V4.

## Related

- [Agent Chat](agent-mode-and-tools.md)
- [Projects](projects.md)
- [Instructions for Agent Chat and Quick Chat](system-prompts.md)
- [Quick Chat](chat-interface.md)
