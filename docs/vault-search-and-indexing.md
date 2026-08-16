# How Agent Searches Your Vault

Copilot V4 Agent starts with local file search and can add Miyo when you want meaning-based search across a large collection.

## Search available to Agent

Agent chooses the lightest useful search for the question:

- **File search** finds exact words, filenames, and phrases with the agent's built-in read, grep, and glob tools. It needs no index or setup and normally starts in the current vault or project workspace.
- **Obsidian-aware search** uses the bundled Obsidian CLI skill when the answer depends on Obsidian's running app or index, such as properties, tags, links, backlinks, tasks, Bases, or open tabs. Ordinary text search still uses file tools. If this capability is unavailable, keep Obsidian open and enable **Settings → General → Command line interface**.
- **Miyo semantic search** finds related notes by meaning, even when they use different words. It is optional and runs through the `miyo-search` skill in opencode, Claude, and Codex.

Agent may use file search first and reach for Miyo when keyword results are too narrow or slow. To request it directly, ask: "Use Miyo to find notes about ..."

## Connect Miyo for semantic search

Miyo is most useful for large vaults, fuzzy recall, and questions that span many notes.

1. Install and open the Miyo desktop app.
2. Open **Settings → Copilot → Miyo**.
3. Under **Connection**, click **Connect**.
4. If prompted with **Register this vault with Miyo**, click **Register & connect**. For a remote Miyo server, open Miyo, add the vault as a folder, and click **Retry**.
5. Under **Powered by Miyo**, turn on **Semantic search**. This installs the `miyo-search` skill for Agent.

A healthy local setup shows **Connected · local**. An endpoint entered under **Remote Miyo server (advanced)** shows **Connected · remote** instead.

### Choose the search scope

The **Search scope** control affects Copilot's integrated Miyo retrieval:

- **Current vault** searches only this vault. This is the safer default.
- **Unrestricted** searches every folder Miyo has indexed.

**Relevant Notes** remains tied to the current vault. The Agent's `miyo-search` skill calls Miyo's document search directly and does not use this scope switch. If Miyo contains several registered folders, keep those registrations intentional and check the note paths Agent cites.

## Refresh and troubleshoot Miyo

- **Unavailable**: open Miyo, return to **Settings → Copilot → Miyo**, and connect again. Check **Remote Miyo server (advanced)** if you use a remote endpoint.
- **Miyo isn't running**: use **Open Miyo**, then **Retry connection**. Use **Download Miyo** if it is not installed.
- **New or changed notes are missing**: run **Index (refresh) vault** from the command palette. This asks Miyo to scan the registered folder; indexing can continue in the Miyo app.
- **Copilot shows an exclusion warning**: click **Resync Miyo**. Copilot does this when Miyo's registered exclusions no longer cover the current Copilot folder. If automatic resync is unavailable, remove and re-add the folder in Miyo. If a registration was rebuilt, re-enable remote read and write access in Miyo if you want it.
- **You want to remove Miyo's indexed copy**: remove the folder in Miyo. **Clear local Copilot index** manages Copilot's older local index, not Miyo's folder index.
- **Miyo search still returns nothing**: confirm that Miyo is running, this vault is registered, and **Semantic search** is on. Try a broader meaning-based question; use Agent's normal file search for exact text.

The **Search chat** row is separate from vault search. **Ready · chats indexed** and **Syncing chats…** refer to ChatGPT and Claude chat history configured in Miyo, not to your notes.

## Turn off the legacy vault index

Vaults upgraded from an earlier version may still run Copilot's own embedding index, the one that predates Miyo. It builds when you switch chat modes and updates as you edit notes, which is noticeable on a large vault.

**Settings → Copilot → Advanced → Legacy vault index** turns it off. Confirm the prompt, and:

- No new indexing starts. A run already under way stops at its next batch, and the progress card in chat reports it as cancelled. To stop one the moment you see it, use the stop button on that card.
- Search falls back to keyword matching.
- The index already on disk is kept, but no longer read or updated. Run **Clear local Copilot index** from the command palette to remove it. A **Force reindex** that was already running is the exception: it clears the index as it starts, so stopping one part-way leaves only what it had rebuilt.

Turning the switch back on does not build an index by itself. Run **Index (refresh) vault** from the command palette when you want one.

If you have connected Miyo, this switch is greyed out. Miyo owns semantic search for the vault, and connecting or disconnecting it on the **Miyo** tab is what sets this.

## Privacy and device boundaries

- File search and the Obsidian CLI run on your computer. Any excerpts Agent uses are then sent to the selected model as chat context. With a cloud model, that means its provider receives those excerpts; with a local model, they stay local.
- By default, Miyo builds and searches its index on your computer with no embedding API key. Search results used by Agent are still passed to the selected model. A remote Miyo endpoint sends indexing and search traffic to the server you configured.
- Miyo's **Connector** is a separate Relay feature that can let ChatGPT or Claude access registered folders from the cloud. Connecting Miyo to Copilot does not enable that Relay by itself.
- Copilot excludes its current and previous Copilot folders from Copilot search and Miyo registration. If you choose a folder that already contains Markdown, those notes become permanently excluded from Copilot search; Obsidian's built-in search is unaffected. Read the confirmation and follow any **Resync Miyo** warning.
- Agent, Agent skills, and local Miyo discovery are desktop features. On mobile, the **Semantic search** skill switch is unavailable and local Miyo cannot be discovered. A remote Miyo server does not make Agent mode available on mobile.

## Related

- [Agents in Copilot V4](agent-mode-and-tools.md)
- [Paid Plans and Self-Host](copilot-plus-and-self-host.md)
- [Projects](projects.md)
