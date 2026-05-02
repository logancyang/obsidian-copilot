# Vault Search Redesign: vaultFind / vaultSearch / readNote

## Summary

Replace the monolithic `localSearch` tool with three focused tools that mirror Unix `find` / `grep` / `cat`: `vaultFind` (list files by metadata), `vaultSearch` (search file contents), and `readNote` (read full note). This separation makes metadata filtering structurally independent from content search, eliminating an entire class of bugs where filters get dropped in certain code paths (e.g., bug #2267 where `timeRange` was silently ignored when Miyo was active).

## Motivation

The current `localSearch` tool handles too many concerns in a single call:

1. **Time-range filtering** (metadata)
2. **Tag matching** (metadata)
3. **Title matching** (metadata)
4. **Content search** via lexical or Miyo backends

These responsibilities are interleaved in complex ways. The `performLexicalSearch` function runs a `FilterRetriever` for metadata matches, then conditionally runs a content retriever, then merges the two result sets. The `performMiyoSearch` function duplicates much of this logic but handles the Miyo code path differently.

**Bug #2267** was a direct consequence: when Miyo was active, `localSearch` called `performMiyoSearch` which did not pass `timeRange` to the `FilterRetriever`, silently dropping time-based filtering. The fix was a one-line change, but the root cause is architectural - the monolithic design makes it easy for any code path to accidentally drop a filter parameter.

**Additional problems with the current design:**

- The LLM must pack metadata filters AND content queries into a single tool call, making it harder for the agent to compose multi-step queries
- Three separate tools (`localSearch`, `semanticSearch`, `lexicalSearch`) exist but overlap heavily, confusing the agent about which to use
- `FilterRetriever` returns full document content even when only metadata is needed, wasting context window budget
- The agent cannot "find files first, then search contents" - it must do everything in one shot

## Design

### Tool 1: `vaultFind` (metadata lookup)

**Purpose:** List files by metadata criteria. Returns file paths and metadata. Never returns file content.

**Always local** - uses Obsidian's `app.vault` and `app.metadataCache`. No Miyo, no embeddings, no external calls.

**Schema:**

```typescript
const vaultFindSchema = z.object({
  timeRange: z.object({
    startTime: z.number().describe("Start time as epoch milliseconds"),
    endTime: z.number().describe("End time as epoch milliseconds"),
  }).optional().describe("Filter by modification time. Use getTimeRangeMs to obtain."),

  tags: z.array(z.string()).optional()
    .describe("Filter by tags. Include '#' prefix, e.g. ['#meeting', '#project/phase1']"),

  folder: z.string().optional()
    .describe("Restrict to a specific folder path, e.g. 'Projects/Q3'"),

  titlePattern: z.string().optional()
    .describe("Filter by title substring match (case-insensitive)"),

  // sortBy: hardcoded to 'mtime' (most recently modified first) — not agent-facing
  // limit: hardcoded to 200 — not agent-facing (no content returned, so high limit is cheap)
});
```

**Returns:**

```typescript
interface VaultFindResult {
  files: Array<{
    path: string;        // Vault-relative path
    title: string;       // Note title (filename without .md)
    mtime: number;       // Last modified (epoch ms)
    ctime: number;       // Created (epoch ms)
    size: number;        // File size in bytes
    tags: string[];      // All tags (frontmatter + inline)
  }>;
  totalMatched: number;  // Total files matching filters (before limit)
}
```

**Implementation notes:**
- Built on top of `FilterRetriever` logic but returns metadata objects, not full `Document` objects with content
- Tags come from `getAllTags(cache)` - free from metadataCache
- Sort hardcoded to `mtime` (most recently modified first), limit hardcoded to 200. Since no content is returned, results are cheap — no need to expose these as agent-facing params.
- Respects `shouldIndexFile` and `isInternalExcludedFile` exclusion rules
- No dependency on any search backend (Miyo, semantic, lexical)

### Tool 2: `vaultSearch` (content search)

**Purpose:** Search file contents for a topic. Returns matching passages with relevance scores.

**Delegates to the best available backend:** Miyo when active, otherwise local lexical. Semantic search is deprecated and will be removed.

**Schema:**

```typescript
const vaultSearchSchema = z.object({
  query: z.string().min(1)
    .describe("The search query to find relevant content in notes"),

  paths: z.array(z.string()).optional()
    .describe("Optional list of file paths to scope search to (from vaultFind results)"),

  // salientTerms: REMOVED from agent-facing schema. The tool extracts keywords
  // internally via TieredLexicalRetriever query expansion. Exposing this to the
  // agent was error-prone (stopword handling, language preservation, # prefixes).

  // returnAll: REMOVED. Default result count is sufficient (30-50). The agent
  // narrows scope with vaultFind paths if it needs more targeted results.
});
```

**Returns:**

```typescript
interface VaultSearchResult {
  type: "local_search";  // Preserved for downstream compatibility
  documents: Array<{
    title: string;
    content: string;     // Matching passage
    path: string;
    score: number;
    rerank_score: number;
    mtime: number | null;
    ctime: number | null;
    source: string;
    // ... other existing fields for compatibility
  }>;
  queryExpansion?: QueryExpansionInfo;
}
```

**Implementation notes:**
- **No metadata filtering logic.** No timeRange, no tags, no folder filtering. Pure content search.
- Delegates to `RetrieverFactory` which handles Miyo > Lexical priority (semantic search is deprecated)
- **Salient terms extracted internally.** The tool extracts keywords from the `query` using the existing `TieredLexicalRetriever` query expansion logic. Not exposed to the agent.
- The `paths` parameter is implemented as:
  - **For Miyo: paths MUST be sent as a filter to the Miyo API.** Miyo must support path-scoped search. This is a required API capability, not optional.
  - For local retrievers: pre-filter the file set before search
- **No cap on `paths` array.** Paths are just strings — cheap to send. The search backend still returns top-K results, so paths only scope the search, they don't inflate context.
- Inherits existing query expansion, deduplication, and CiC formatting logic

### Tool 3: `readNote` (unchanged)

Already exists. Reads full content of a specific note with line-chunking. No changes needed.

## Query Examples

### 1. "What did I do last week?" - Pure metadata

```
Unix: find ./vault -name "*.md" -mtime -7
```

```
Agent: getTimeRangeMs("last week")
     → vaultFind(timeRange={...})
     → Summarize from titles/headings
     → Optionally readNote on interesting files
```

### 2. "Find notes about machine learning" - Pure content search

```
Unix: grep -r "machine learning" ./vault
```

```
Agent: vaultSearch(query="machine learning")
     → Present matching passages
```

### 3. "Notes about person A from last week" - Multi-step composition

```
Unix: find ./vault -mtime -7 | xargs grep "person A"
```

```
Agent: getTimeRangeMs("last week")
     → vaultFind(timeRange={...})
     → vaultSearch(query="person A", paths=[...from vaultFind...])
```

### 4. "Notes tagged #meeting from this month" - Combined metadata filters

```
Unix: find ./vault -name "*.md" -mtime -30 + filter by tag
```

```
Agent: getTimeRangeMs("this month")
     → vaultFind(timeRange={...}, tags=["#meeting"])
```

### 5. "Summarize meeting notes from last week in Q3Meetings folder" - Metadata + full read

```
Unix: find ./Q3Meetings -name "*.md" -mtime -7 → cat each
```

```
Agent: getTimeRangeMs("last week")
     → vaultFind(timeRange={...}, folder="Q3Meetings")
     → readNote on each file
     → Synthesize summary
```

### 6. "Notes about budgeting from January" - Time scoping + content search

```
Unix: find ./vault -mtime range + grep "budgeting"
```

```
Agent: getTimeRangeMs("January 2026")
     → vaultFind(timeRange={...})
     → vaultSearch(query="budgeting", paths=[...])
```

### 7. "Everything about AI in my Research folder" - Folder scoping + content

```
Unix: grep -r "AI" ./Research
```

```
Agent: vaultFind(folder="Research")
     → vaultSearch(query="AI", paths=[...])
```

### 8. "Compare what I wrote about React vs Vue" - Parallel content searches

```
Unix: grep -r "React" ./vault ; grep -r "Vue" ./vault
```

```
Agent: vaultSearch(query="React")
     + vaultSearch(query="Vue")   (parallel)
     → Compare results
```

### 9. "Which meeting notes mention John?" - Tag filter then content search

```
Unix: find by tag #meeting | grep "John"
```

```
Agent: vaultFind(tags=["#meeting"])
     → vaultSearch(query="John", paths=[...])
```

### 10. "What's in my daily note from yesterday?" - Find then read

```
Unix: find -mtime -1 → cat
```

```
Agent: getTimeRangeMs("yesterday")
     → vaultFind(timeRange={...})
     → readNote(path=...)
```

### 11. "Summarize the budget discussions in my meeting notes from last week under Q3Meetings" - Time + folder + content search

```
Unix: find ./Q3Meetings -name "*.md" -mtime -7 | xargs grep "budget"
```

```
Agent: getTimeRangeMs("last week")
     → vaultFind(timeRange={...}, folder="Q3Meetings")
     → vaultSearch(query="budget discussions", paths=[...from vaultFind...])
     → Summarize matching passages
```

This is the most complex composition pattern — it combines time filtering, folder scoping, AND content search in three distinct steps. With the old monolithic `localSearch`, all three dimensions would be packed into a single call, which is exactly the pattern that caused #2267.

## Agent Instructions

These instructions replace the current `localSearch` custom prompt instructions:

```
## Vault Tools

vaultFind - List files by metadata (time, tags, folder, title).
  Returns: path, title, mtime, tags. No file content.
  Use when: you need to know WHICH files exist.

vaultSearch - Search inside file contents for a topic.
  Returns: matching passages with relevance scores.
  Use when: you need to know WHAT files say.
  Optional: pass `paths` from a vaultFind result to narrow scope.

readNote - Read full content of one note (chunked).
  Use when: you need the complete text of a specific file.

## Patterns
"what did I do last week?"     → vaultFind(timeRange=...)
"notes about machine learning" → vaultSearch(query="machine learning")
"notes about X from last week" → vaultFind(timeRange=...) → vaultSearch(query="X", paths=[...])
"read my project plan"         → readNote(path="...")

## Rules
- For time-based queries, always call getTimeRangeMs FIRST, then pass the result to vaultFind
- Preserve the original language - do NOT translate search terms to English
- Tags must include '#' prefix: ["#meeting"], not ["meeting"]
- When vaultFind returns many files and you need content, use vaultSearch with paths to narrow scope
- If vaultFind returns 0 results, try broadening filters or use vaultSearch without paths
```

## Migration Plan

### What Gets Replaced

| Current | New | Notes |
|---------|-----|-------|
| `localSearch` tool | `vaultFind` + `vaultSearch` | Monolith split into two focused tools |
| `semanticSearch` tool | Deprecated and removed | Semantic search is being retired |
| `lexicalSearch` tool | Absorbed into `vaultSearch` | Backend selection handled internally |
| `FilterRetriever` in search path | Powers `vaultFind` | Returns metadata instead of full documents |
| `performLexicalSearch()` | `vaultSearch` internals | Simplified - no filter merging |
| `performMiyoSearch()` | `vaultSearch` internals | Simplified - no filter merging |

### What Stays

| Component | Reason |
|-----------|--------|
| `readNote` | Unchanged - already focused and well-designed |
| `getFileTree` | Complementary to `vaultFind` - shows vault structure |
| `getTimeRangeMs` | Unchanged - time expression parsing |
| `webSearch` | Unchanged - internet search |
| `indexVault` | Unchanged - index management |
| `RetrieverFactory` | Still handles Miyo > Lexical priority for `vaultSearch` |
| `TieredLexicalRetriever` | Backend for `vaultSearch` when lexical mode active |
| `MiyoSemanticRetriever` | Backend for `vaultSearch` when Miyo active |

### Backwards Compatibility

- The `localSearch` tool ID is removed from `BUILTIN_TOOLS` and replaced with `vaultFind` + `vaultSearch`
- Default enabled tool IDs in `constants.ts` are updated to include `vaultFind` and `vaultSearch`
- Users who had `localSearch` enabled in their settings will need a migration to enable the new tools
- The return type of `vaultSearch` preserves `{ type: "local_search", documents: [...] }` for downstream compatibility with CiC formatting, citation rendering, and the "Show Sources" UI

### Settings Migration

Add a settings migration that:
1. If `autonomousAgentEnabledToolIds` contains `"localSearch"`, replace it with `["vaultFind", "vaultSearch"]`
2. Remove `"semanticSearch"` (deprecated) and `"lexicalSearch"` (absorbed into `vaultSearch`) if present

## Implementation Notes

### Key Technical Decisions

1. **`vaultFind` is always local.** It never calls Miyo or any external service. This is the core architectural invariant that prevents the #2267 bug class. Metadata filtering uses `app.vault`, `app.metadataCache`, and `getAllTags()` - all synchronous Obsidian APIs.

2. **`vaultSearch` never filters by metadata.** It only searches content. If you need time-scoped content search, you do `vaultFind(timeRange) → vaultSearch(paths)`. The `paths` parameter is the only way to scope a content search to a subset of files.

3. **No cap on the `paths` parameter.** Paths are just strings — cheap to send. The search backend returns top-K results regardless, so paths only scope the search without inflating context.

4. **No Node.js `fs` dependency.** Everything uses Obsidian's vault API for mobile compatibility. `vaultFind` uses `app.vault.getMarkdownFiles()`, `app.metadataCache`, etc.

5. **Content budget is the agent's responsibility.** The tools provide data; the agent decides how much to consume:
   - Small set (10 or fewer files): `readNote` each, then synthesize
   - Medium set (10-50): `vaultSearch` with paths to pull most relevant passages
   - Large set (50+): Agent narrows scope with tighter `vaultFind` filters, or passes all paths to `vaultSearch` (which returns top-K regardless)

6. **Both tools use `createLangChainTool()`.** Registered in `ToolRegistry` with appropriate categories. `vaultFind` is category `"search"`, `vaultSearch` is category `"search"`.

7. **`vaultSearch` handles query expansion internally.** The `TieredLexicalRetriever` query expansion logic (salient terms, expanded queries, recall terms) runs inside the tool — not exposed to the agent. The agent only provides `query`.

### File Changes

**New files:**
- `src/tools/VaultFindTool.ts` - `vaultFind` implementation
- `src/tools/VaultSearchTool.ts` - `vaultSearch` implementation (refactored from `SearchTools.ts`)

**Modified files:**
- `src/tools/builtinTools.ts` - Replace `localSearch` registration with `vaultFind` + `vaultSearch`
- `src/constants.ts` - Update default enabled tool IDs
- `src/settings/model.ts` - Settings migration for tool ID rename

**Removed/deprecated:**
- `src/tools/SearchTools.ts` - Replaced by `VaultFindTool.ts` + `VaultSearchTool.ts`
  - `webSearchTool` and `indexTool` move to their own files or stay in a slimmed-down `SearchTools.ts`
  - `localSearchTool`, `semanticSearchTool`, `lexicalSearchTool` are removed

### Implementation Order

1. Create `VaultFindTool.ts` - extract metadata logic from `FilterRetriever`, return metadata-only results
2. Create `VaultSearchTool.ts` - refactor `performLexicalSearch`/`performMiyoSearch` into a single content-search path, add `paths` parameter support
3. Update `builtinTools.ts` - swap tool registrations and agent instructions
4. Update settings migration - handle `localSearch` → `vaultFind` + `vaultSearch` rename
5. Update tests - new tests for `vaultFind` and `vaultSearch`, remove old `localSearch` tests
6. Update CiC formatting if needed - ensure `vaultSearch` results integrate with existing citation/source rendering

## Resolved Design Decisions

1. **`vaultFind` uses substring title matching only.** No regex — substring is simpler and sufficient.

2. **`vaultSearch` has NO metadata parameters.** No `folder`, no `timeRange`, no `tags`. Keeping `vaultSearch` pure (content only) is the whole point of the split. The agent composes `vaultFind → vaultSearch(paths)` for scoped content search.

3. **`vaultSearch` + Miyo: paths MUST be sent as an API filter.** Miyo must support path-scoped search as a required capability. Post-filtering is not acceptable — it silently drops relevant results when top-K doesn't overlap with the specified paths.

4. **`vaultFind` returns NO content preview and NO headings.** Metadata only: path, title, mtime, ctime, size, tags. This keeps results cheap and maximizes the useful limit (200 files).

5. **`salientTerms` removed from agent-facing schema.** The tool extracts keywords internally via `TieredLexicalRetriever` query expansion. Exposing this to the agent was error-prone.

6. **`sortBy`, `limit` removed from agent-facing schema.** Hardcoded to `mtime` sort, limit 200. Since no content is returned, high limits are cheap.

7. **No cap on `paths` parameter.** Paths are strings — cheap to send. Search backend returns top-K regardless.

8. **`returnAll` removed from agent-facing schema.** Default result count is sufficient. Agent narrows scope with `vaultFind` paths for more targeted results.

9. **Semantic search is deprecated.** Only lexical + Miyo backends remain. `semanticSearch` tool is removed, not absorbed.

## Open Questions

1. **Migration UX:** Should we show a one-time notice to users that `localSearch` has been replaced? Or just silently migrate the settings?
