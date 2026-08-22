# Miyo: Local-First Search and AI Ownership

Copilot V4 uses ordinary file tools for exact text and file lookup. For meaning-based search across a large vault, connect [Miyo](https://miyo.md).

Miyo is a local-first knowledge service built for more than one plugin. It can search notes by meaning, process supported documents, search selected chat histories, and make the same knowledge available to the AI tools you choose. Your knowledge stays in a system you control instead of being locked inside one chat feature.

## What moved from Copilot V3

Semantic search from Copilot V3 has moved to Miyo. Connect Miyo and enable its semantic-search Skill for a more powerful local-first path; you do not need to rebuild or tune Copilot's retiring in-plugin index for Agent Chat.

## How Agent Chat searches

Agent Chat can combine three kinds of search:

- **File search** finds exact words, phrases, filenames, and paths with the active agent's normal tools. It needs no index.
- **Obsidian-aware search** uses the Obsidian CLI skill when a question depends on Obsidian's index, such as links, backlinks, properties, tags, tasks, Bases, or the currently open note.
- **Miyo semantic search** finds related ideas even when the notes use different words. It is useful for fuzzy recall, research across many notes, and large collections.

You can ask naturally, such as “Find everything I have written about memory consolidation,” or say “Use Miyo” when you want semantic search explicitly. Search results become context for the model you selected, so the model still receives the excerpts Agent Chat uses in its answer.

## Connect Miyo

1. Download and open Miyo from [miyo.md](https://miyo.md).
2. Open **Settings → Copilot → Miyo**.
3. Select **Connect**. Copilot discovers a local Miyo automatically.
4. If prompted, register the current vault with Miyo.
5. Turn on **Semantic search** under **Powered by Miyo**.

A healthy local connection shows **Connected · local**. If you run Miyo on another computer or server, expand the advanced connection row and enter its address. The status then shows **Connected · remote**.

The remote option changes the privacy boundary: indexing and search requests go to the Miyo server you entered instead of staying on the current computer.

## Choose what Miyo can search

Use **Search scope** in the Miyo settings tab:

- **Current vault** keeps Copilot's integrated Miyo searches within this vault. This is the safer default when Miyo manages several folders.
- **Unrestricted** allows searches across everything registered with that Miyo instance.

The scope is a retrieval preference, not a security boundary. Keep Miyo's registered folders intentional, especially when you use an unrestricted scope or connect to a shared remote server.

### Relevant Notes

Relevant Notes always includes direct links and backlinks that pass Copilot's search scope. Miyo is the only source of semantic matches and similarity percentages in this pane; Copilot's legacy local embedding index no longer scores Relevant Notes.

If Miyo is disabled, link and backlink rows stay visible without percentages and the pane offers Miyo download and setup actions. If Miyo is unavailable or the vault registration cannot be confirmed, the same rows remain visible and **Open Miyo settings** returns directly to the existing connection flow under **Settings → Copilot → Miyo**, including when you use a remote endpoint or mobile device.

A successful search with zero results shows **No semantic matches yet** without treating the empty result as a setup failure. When Miyo reports that the active path has no indexed chunks but the vault is registered, the pane instead shows **This note isn't indexed in Miyo**. Miyo uses that response for both a note that is still indexing and a path excluded from Miyo, so Copilot does not claim to know which one applies. On a local desktop connection, **Open Miyo** opens the Miyo app so you can review the folder's indexing and exclusion settings. Mobile and remote connections instead offer **Review Miyo connection**, which opens Copilot's Miyo tab to review the configured server without implying that Copilot can change Miyo's exclusions. Copilot's own inclusion and exclusion rules remain separate: a locally excluded active note still shows **This note is excluded**.

## Search conversations and process documents

Miyo can also index supported ChatGPT and Claude chat histories. Configure those sources in Miyo, then use the **Search chat** row in Copilot to see their status and open Miyo's management screen. Chat-history search is separate from vault search.

The **Document Processor** setting affects more than one chat surface, so check the route you use:

- In **Agent Chat**, **Miyo** runs the local `miyo-parse` CLI for PDF and EPUB files. This stays on the current computer even when semantic search uses a remote Miyo server. If the local CLI is unavailable, Agent Chat stops instead of falling back to a cloud parser.
- In **Quick Chat**, **Miyo** asks the connected Miyo service to parse PDF and EPUB files. A local connection stays local; a configured remote connection processes them on that server and requires the server to have access to the registered vault files.
- **Plus** can use Copilot-hosted PDF processing and may consume paid usage.

Outside the Miyo route, EPUB and ordinary non-PDF formats such as DOCX are not processed by this selector in regular chat context. Projects have a separate context-conversion route that can use hosted processing. See [Copilot Paid Plans and Data Routes](copilot-plus-and-self-host.md) before using sensitive documents.

## Let other AI tools use your knowledge

Miyo's Connector can let supported ChatGPT and Claude clients work with files you registered in Miyo. Set it up from the **Connector** row in Copilot's Miyo settings or from Miyo itself. Local desktop and command-line use is free. Remote Connector access requires Miyo Relay or Lifetime access after its trial; Supporter and eligible legacy Copilot licenses can include that access.

Connector access is separate from Agent Chat search. Review the folders, remote access, and write permissions in Miyo before enabling it. This is the ownership advantage of Miyo: one local-first knowledge layer can serve several AI tools without turning Copilot's private plugin data into the permanent home of your knowledge.

## Troubleshooting

- **Unavailable:** open Miyo, return to **Settings → Copilot → Miyo**, and retry. Check the remote server address if you configured one.
- **Register this vault:** register the folder in Miyo, then connect again.
- **Semantic search is missing:** confirm the connection is healthy and turn on **Semantic search**. Copilot installs the shared Miyo skill for opencode, Claude, and Codex.
- **New notes are missing:** ask Miyo to refresh the registered folder. Indexing progress is shown in Miyo.
- **Relevant Notes has no semantic results:** **No semantic matches yet** means Miyo answered successfully but found no related notes. **This note isn't indexed in Miyo** means the note may still be indexing or may be excluded from Miyo. Links and backlinks remain visible in either state.
- **Agent Chat Miyo document processing fails:** install Miyo on this computer so its local CLI is available, or switch **Document Processor** to **Plus**. A remote Miyo search connection does not provide the local CLI Agent Chat needs.
- **Quick Chat Miyo document processing fails:** confirm that the connected Miyo service can access the registered vault and document. When a remote server is configured, troubleshoot the document on that server.
- **Copilot asks for a resync:** use **Resync Miyo** so Miyo excludes Copilot's own working folder and conversation files.
- **Mobile:** a remote Miyo server can be configured on mobile, but Agent Chat and its Skills are desktop features. Use Quick Chat on mobile.

## Related

- [Settings: Miyo](settings.md#miyo)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Copilot Paid Plans and Data Routes](copilot-plus-and-self-host.md)
