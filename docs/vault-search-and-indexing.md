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

Miyo is the source of Relevant Notes results and similarity percentages; Copilot's legacy local embedding index no longer scores this pane. Copilot keeps Miyo's result order. Direct links and backlinks annotate notes returned by Miyo but never add their own rows. Relevant Notes does not apply Copilot's inclusion or exclusion patterns; the registered folder's Miyo scope determines which notes can appear.

If Miyo is disabled, unavailable, or its vault registration cannot be confirmed, the pane does not fall back to link and backlink rows. Instead, it offers Miyo download or setup actions. **Open Miyo settings** returns directly to the existing connection flow under **Settings → Copilot → Miyo**, including when you use a remote endpoint or mobile device.

A successful search with zero results shows **No semantic matches yet** without treating the empty result as a setup failure. If the active note has no indexed chunks, Copilot asks Miyo for that file's current state:

- **Miyo found no text in this note** means Miyo processed the file but found no searchable text.
- **Miyo is still indexing this note** covers files that are pending, not scanned yet, or not yet visible to Miyo. Select **Refresh** to check again.
- **Miyo couldn't index this note** includes Miyo's error message. On a local desktop connection, **Open Miyo** opens this vault's folder under Sources.
- **This note is excluded in Miyo** names the matching filter when Miyo provides it. On a local desktop connection, **Open folder settings in Miyo** opens this vault's folder under Sources.

For a remote Miyo or mobile device, error and exclusion cards tell you to review the folder on the host machine. Copilot cannot open or change that machine's Miyo settings. Older Miyo builds show **This note isn't indexed in Miyo** and **Update Miyo to the latest version to see why** because they cannot report the more specific reason. Their local desktop action still opens the vault's folder under Sources; remote and mobile connections offer **Review Miyo connection** in Copilot.

Links and backlinks do not create rows in any of these empty states. Copilot's own inclusion and exclusion patterns do not filter Relevant Notes; Miyo's folder filters are the only scope there.

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
- **Relevant Notes has no semantic results:** Read the card for the active note's Miyo state. **No semantic matches yet** means Miyo found no related notes. The other cards distinguish an empty note, indexing work, an indexing error, and a Miyo folder filter. Older Miyo builds use the less specific **This note isn't indexed in Miyo** card. None of these states shows link-only or backlink-only rows.
- **Agent Chat Miyo document processing fails:** install Miyo on this computer so its local CLI is available, or switch **Document Processor** to **Plus**. A remote Miyo search connection does not provide the local CLI Agent Chat needs.
- **Quick Chat Miyo document processing fails:** confirm that the connected Miyo service can access the registered vault and document. When a remote server is configured, troubleshoot the document on that server.
- **Copilot asks for a resync:** use **Resync Miyo** so Miyo excludes Copilot's own working folder and conversation files.
- **Mobile:** a remote Miyo server can be configured on mobile, but Agent Chat and its Skills are desktop features. Use Quick Chat on mobile.

## Related

- [Settings: Miyo](settings.md#miyo)
- [Agent Chat](agent-mode-and-tools.md)
- [Context and Mentions](context-and-mentions.md)
- [Copilot Paid Plans and Data Routes](copilot-plus-and-self-host.md)
