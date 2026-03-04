# TODO - Obsidian CLI Integration Priorities

This document tracks prioritized integration opportunities between the Obsidian CLI and the Copilot plugin's AI agent tool system. Each item identifies a capability gap, its user value, and a recommended implementation approach.

> **Architecture Note:** Since Copilot runs **inside** Obsidian, CLI commands should be implemented as internal API tool calls (using `app.vault`, `app.metadataCache`, `app.fileManager`, etc.) rather than shelling out to the CLI binary. The CLI command set serves as a **capability roadmap** — a reference for what tools to build.

---

## P0 — Must Have (Critical Gaps, Highest User Value)

### 1. [TODO] Property Management — `property:set` / `property:read` / `property:remove` / `properties` (P0)

#### What It Does

Read, write, and remove YAML frontmatter properties on notes. List all properties across the vault with occurrence counts.

#### Priority Justification

- **Current gap:** Complete. Copilot has zero frontmatter management capability. The only way to modify frontmatter today is `writeToFile`, which requires rewriting the entire file.
- Frontmatter is the backbone of Obsidian knowledge management (tags, dates, status, categories, ratings, custom fields). This is one of the most requested AI capabilities.

#### User Value

Extremely high. Users can ask the AI to auto-categorize notes, set status fields, tag content, and manage metadata workflows (e.g., "mark all my meeting notes from last week as reviewed").

#### AI Synergy

AI can analyze note content and set appropriate properties automatically. Enables bulk metadata operations that would be tedious manually.

#### Implementation Notes

- Use `app.fileManager.processFrontMatter()` internally (already used in `main.ts:708` for `lastAccessedAt`)
- Create `src/tools/PropertyTools.ts` with tools: `readProperty`, `setProperty`, `removeProperty`, `listProperties`
- Schema: `{ notePath: string, name: string, value?: string|number|boolean|string[], type?: string }`
- Register in `builtinTools.ts` under a new `"property"` category

---

### 2. [TODO] Task Management — `tasks` / `task` (P0)

#### What It Does

List tasks across the vault with filters (file, status, done/todo), and toggle individual task status (done, todo, custom status characters).

#### Priority Justification

- **Current gap:** Complete. No task interaction whatsoever in the current tool set.
- Task management is a top-3 Obsidian workflow. Users want AI to help track, organize, and complete tasks.

#### User Value

Very high. Users can ask: "summarize all open tasks", "find overdue items", "mark tasks done after discussing them", "create a weekly task review".

#### AI Synergy

Transformative. AI can generate task reports, identify overdue items, toggle task status based on conversation context, and integrate task management with search and daily notes.

#### Implementation Notes

- Use `app.metadataCache` to find tasks (`listItems` with task property in cached file metadata)
- Parse task status from markdown checkboxes: `- [ ]`, `- [x]`, `- [/]`, etc.
- Toggle tasks by reading file content and replacing the specific line
- Create `src/tools/TaskTools.ts` with tools: `listTasks`, `updateTaskStatus`
- Schema for `listTasks`: `{ file?: string, status?: string, done?: boolean, todo?: boolean, limit?: number }`
- Schema for `updateTaskStatus`: `{ notePath: string, line: number, status: string }`

---

### 3. [TODO] Daily Note Integration — `daily:read` / `daily:append` / `daily:prepend` / `daily:path` (P0)

#### What It Does

Read, append to, and prepend to the daily note. Get the daily note path based on user-configured format and folder.

#### Priority Justification

- **Current gap:** Significant. While `readNote` can read a daily note if the exact path is known, there is no convenient daily note integration. Users must know the exact path and date format.
- Daily notes are the #1 Obsidian workflow for most users.

#### User Value

Very high. Users can ask: "what did I write today?", "add this task to my daily note", "summarize my daily notes from this week", "prepend a morning planning prompt".

#### AI Synergy

High. AI can review daily progress, append new tasks and ideas, generate daily summaries, and integrate daily notes with task management.

#### Implementation Notes

- Use Obsidian's daily note API or moment-based path resolution from core plugin settings
- Key challenge: daily note path format varies per user settings (folder, date format, template)
- Create `src/tools/DailyNoteTools.ts` with tools: `readDailyNote`, `appendToDailyNote`, `prependToDailyNote`, `getDailyNotePath`
- Schema for append/prepend: `{ content: string, inline?: boolean }`

---

### 4. [TODO] Append / Prepend to Any Note — `append` / `prepend` (P0)

#### What It Does

Add content to the beginning or end of any note without overwriting its existing content.

#### Priority Justification

- **Current gap:** Significant. `writeToFile` replaces the **entire file** content. `replaceInFile` requires finding exact text to replace (and only works on files > 3000 chars). There is no way to incrementally add content to a note.
- Adding to notes (journaling, collecting thoughts, appending meeting notes) is a fundamental workflow.

#### User Value

High. Users can ask: "add these action items to my meeting notes", "append a summary to this note", "log this idea to my inbox".

#### AI Synergy

High. AI can add insights, summaries, related links, and new sections to existing notes without risk of overwriting content.

#### Implementation Notes

- Simple pattern: `app.vault.read(file)` → prepend/append content → `app.vault.modify(file, newContent)`
- Two implementation approaches:
  1. Extend `writeToFile` in `ComposerTools.ts` with a `mode` parameter (`"overwrite" | "append" | "prepend"`)
  2. Create dedicated `appendToNote` and `prependToNote` tools
- Option 1 is recommended (less tool proliferation, reuses existing preview/confirmation UX)
- Schema addition: `mode?: "overwrite" | "append" | "prepend"`, `inline?: boolean`

---

## P1 — High Value (Strong AI Synergy, Moderate Gap)

### 5. [TODO] Backlinks and Outgoing Links — `backlinks` / `links` (P1)

#### What It Does

List incoming links (backlinks) and outgoing links for a note, with optional counts and file paths.

#### Priority Justification

- **Current gap:** Significant. `readNote` returns a `linkedNotes` array (outgoing wikilinks parsed from content), but there is no way to find **backlinks** (which notes link TO a given note).
- Graph relationships are central to Obsidian's value proposition.

#### User Value

High. Users can ask: "what notes reference this project?", "find all notes that link to my meeting notes", "show me related content".

#### AI Synergy

AI can reason about note relationships, discover related content through the knowledge graph, and build contextual understanding of how notes connect.

#### Implementation Notes

- Use `app.metadataCache.resolvedLinks` for outgoing links
- Use `app.metadataCache.getBacklinksForFile(file)` for backlinks (internal API)
- Create `src/tools/LinkTools.ts` with tools: `getBacklinks`, `getOutgoingLinks`
- Schema: `{ notePath: string, total?: boolean }`

---

### 6. [TODO] Note Outline / Heading Structure — `outline` (P1)

#### What It Does

Get the heading hierarchy of a note as a structured tree (heading text, level, line position).

#### Priority Justification

- **Current gap:** Moderate. `readNote` provides raw content but no structured heading tree. The AI must parse headings from raw markdown.
- Helps AI navigate long notes efficiently by understanding structure before reading content.

#### User Value

Medium-high. Enables smarter note navigation: AI reads the outline first, then targets only relevant sections.

#### AI Synergy

AI can understand note structure, request only relevant chunks, and provide better responses about note organization.

#### Implementation Notes

- Use `app.metadataCache.getFileCache(file)?.headings` to get heading metadata
- Return structured heading hierarchy with levels, text, and line positions
- Could be added to `NoteTools.ts` or as a standalone `OutlineTools.ts`
- Schema: `{ notePath: string, format?: "tree" | "flat" }`

---

### 7. [TODO] Template Integration — `template:read` / `template:insert` / `templates` (P1)

#### What It Does

List available templates, read template content (with optional variable resolution), and insert templates into notes.

#### Priority Justification

- **Current gap:** Complete. No template interaction in the current tool set.
- Template-based note creation is a key Obsidian workflow.

#### User Value

Medium-high. Users can ask: "create a new meeting note using my meeting template", "what templates do I have?", "apply the project template to this note".

#### AI Synergy

AI can create properly structured notes from templates, understand available templates, and fill in template variables with context-aware content.

#### Implementation Notes

- Access template folder path from Obsidian core plugin settings
- Use `app.vault.read()` for template content
- Template insertion requires understanding Obsidian's template variable resolution (`{{date}}`, `{{title}}`, etc.)
- Create `src/tools/TemplateTools.ts` with tools: `listTemplates`, `readTemplate`, `insertTemplate`

---

### 8. [TODO] Execute Obsidian Commands — `command` / `commands` (P1)

#### What It Does

List all registered Obsidian commands and execute them by ID. This is a meta-capability that enables triggering any Obsidian feature.

#### Priority Justification

- **Current gap:** Complete. No way to trigger Obsidian commands from the AI agent.
- Potentially very high value as a meta-capability (open graph view, toggle reading mode, run other plugin commands).
- **Risk:** Security/safety concerns with arbitrary command execution require careful scoping.

#### User Value

High for power users. Enables: "open graph view", "toggle dark mode", "run Dataview refresh", "enable focus mode".

#### AI Synergy

Enables AI to trigger ANY Obsidian feature, making it a true automation assistant.

#### Implementation Notes

- Use `app.commands.executeCommandById(id)` for execution
- Use `app.commands.listCommands()` for discovery
- **Must** implement safety constraints: allowlisted commands, user confirmation for destructive ones, or a configurable blocklist
- Create `src/tools/CommandTools.ts` with tools: `listCommands`, `executeCommand`
- Schema: `{ commandId: string }` with safety validation

---

### 9. [TODO] Bookmark Management — `bookmarks` / `bookmark` (P1)

#### What It Does

List existing bookmarks and create new bookmarks for files, folders, searches, or URLs.

#### Priority Justification

- **Current gap:** Complete. No bookmark interaction.
- Bookmarks are useful but secondary to core note management.

#### User Value

Medium. AI can bookmark important search results, notes for later review, or frequently referenced content.

#### AI Synergy

AI can organize bookmarks based on conversation context, bookmark relevant findings during research workflows.

#### Implementation Notes

- Use Obsidian's bookmark core plugin API
- Create bookmark tools or integrate into existing file tools
- Schema: `{ file?: string, search?: string, url?: string, title?: string }`

---

## P2 — Nice to Have (Complementary, Low Gap)

### 10. [TODO] Native Text Search — `search` / `search:context` (P2)

#### What It Does

Search vault for text using Obsidian's built-in search engine, with optional line-level context.

#### Priority Justification

- Copilot already has excellent search (lexical + semantic + hybrid + reranking via `localSearch` and `semanticSearch`).
- CLI search would be complementary for **exact text matching** but offers low incremental value over existing tools.

#### Implementation Notes

- Could be useful as a fallback when Copilot's search misses exact text matches
- Lower priority given existing search infrastructure

---

### 11. [TODO] Vault Health Tools — `orphans` / `deadends` / `unresolved` (P2)

#### What It Does

List files with no incoming links (orphans), no outgoing links (deadends), and unresolved wikilinks.

#### Priority Justification

- AI could help identify and fix broken links, orphan notes, and dead-end notes.
- Useful for vault maintenance workflows but not daily use.

#### Implementation Notes

- Use `app.metadataCache.resolvedLinks` and `app.metadataCache.unresolvedLinks`
- Create `src/tools/VaultHealthTools.ts`

---

### 12. [TODO] File Move / Rename — `move` / `rename` (P2)

#### What It Does

Move or rename files while maintaining all wikilink references across the vault.

#### Priority Justification

- Not critical since `writeToFile` + delete can achieve file creation at new paths.
- However, proper `move` maintains all wikilink references, which is important for vault integrity.

#### Implementation Notes

- Use `app.fileManager.renameFile()` which automatically updates links
- Schema: `{ notePath: string, newPath: string }`

---

### 13. [TODO] Base / Database Integration — `base:query` / `base:create` (P2)

#### What It Does

Query structured data from Obsidian Base files and create new items.

#### Priority Justification

- Base is Obsidian's database feature (relatively new).
- AI querying structured data would be valuable for users who use Base.
- Lower priority since Base adoption is still growing.

#### Implementation Notes

- Depends on Base plugin API availability
- Schema: `{ file: string, view?: string, format?: string }`

---

### 14. [TODO] Plugin Reload — `plugin:reload` (P2, Developer Only)

#### What It Does

Reload a plugin by ID without restarting Obsidian.

#### Priority Justification

- Already documented in `CLAUDE.md` for developer workflow.
- Critical for Copilot developers, irrelevant for end users.
- Not a user-facing tool.

#### Implementation Notes

- CLI command: `/Applications/Obsidian.app/Contents/MacOS/obsidian plugin:reload id=copilot`
- Already used in development workflow

---

### 15. [TODO] Developer Tools — `dev:console` / `dev:errors` / `eval` (P2, Developer Only)

#### What It Does

Show captured console messages, errors, and execute JavaScript in the app context.

#### Priority Justification

- Developer debugging tools. Not user-facing.
- `eval` could theoretically be a meta-capability for the AI agent, but security risk is extreme.

#### Implementation Notes

- For development workflow only
- `eval` should **never** be exposed as an AI tool due to arbitrary code execution risk

---

## P3 — Low Priority (Minimal Gap or Low AI Synergy)

The following CLI commands have minimal integration value for the Copilot AI agent:

| Command                                                         | Reason for Low Priority                  |
| --------------------------------------------------------------- | ---------------------------------------- |
| `aliases`                                                       | Niche metadata, low AI synergy           |
| `wordcount`                                                     | Copilot already has token counting       |
| `recents`                                                       | Low AI synergy                           |
| `random` / `random:read`                                        | Niche use case                           |
| `tabs` / `tab:open` / `workspace`                               | UI management, not AI territory          |
| `vault` / `vaults`                                              | Metadata already available via `app` API |
| `plugins` / `plugin:enable/disable/install/uninstall`           | Not an AI workflow                       |
| `themes` / `snippets`                                           | Appearance management                    |
| `hotkeys` / `hotkey`                                            | Configuration, not AI                    |
| `sync` / `sync:status/history/read/restore`                     | User-managed sync operations             |
| `history` / `diff`                                              | Specialized version management           |
| `web`                                                           | Copilot already has web search           |
| `dev:dom`, `dev:css`, `dev:screenshot`, `dev:cdp`, `dev:mobile` | Developer tools                          |
| `version`, `restart`, `reload`                                  | System commands                          |

---

## Implementation Roadmap

### Phase 1 — P0 Tools (4 new tool groups)

| #   | Tool Group             | New File                            | Tools                                                                          |
| --- | ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| 1   | Property Management    | `src/tools/PropertyTools.ts`        | `readProperty`, `setProperty`, `removeProperty`, `listProperties`              |
| 2   | Task Management        | `src/tools/TaskTools.ts`            | `listTasks`, `updateTaskStatus`                                                |
| 3   | Daily Note Integration | `src/tools/DailyNoteTools.ts`       | `readDailyNote`, `appendToDailyNote`, `prependToDailyNote`, `getDailyNotePath` |
| 4   | Append / Prepend       | Extend `src/tools/ComposerTools.ts` | Add `mode` parameter to `writeToFile`                                          |

### Phase 2 — P1 Tools (4 new tool groups)

| #   | Tool Group           | New File                                             | Tools                                                      |
| --- | -------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| 5   | Link Navigation      | `src/tools/LinkTools.ts`                             | `getBacklinks`, `getOutgoingLinks`                         |
| 6   | Note Outline         | `src/tools/OutlineTools.ts` or extend `NoteTools.ts` | `getNoteOutline`                                           |
| 7   | Template Integration | `src/tools/TemplateTools.ts`                         | `listTemplates`, `readTemplate`, `insertTemplate`          |
| 8   | Command Execution    | `src/tools/CommandTools.ts`                          | `listCommands`, `executeCommand` (with safety constraints) |

### Phase 3 — P2 Tools (selected)

| #   | Tool Group      | New File                          | Tools                                           |
| --- | --------------- | --------------------------------- | ----------------------------------------------- |
| 9   | Vault Health    | `src/tools/VaultHealthTools.ts`   | `listOrphans`, `listDeadends`, `listUnresolved` |
| 10  | File Operations | `src/tools/FileOperationTools.ts` | `moveNote`, `renameNote`                        |
| 11  | Base / Database | `src/tools/BaseTools.ts`          | `queryBase`, `createBaseItem`                   |

---

### References

- [Obsidian CLI Documentation](https://help.obsidian.md/cli)
- Current Copilot tools: `src/tools/builtinTools.ts`
- Tool registry: `src/tools/ToolRegistry.ts`
- Tool creation pattern: `src/tools/createLangChainTool.ts`

---

_Last updated: 2026-03-03_
