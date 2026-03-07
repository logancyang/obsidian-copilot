# Vault Search Redesign: vaultFind / vaultSearch / readNote

## Summary

Replace the monolithic `localSearch` tool with three focused tools that mirror Unix `find` / `grep` / `cat`: `vaultFind` (list files by metadata), `vaultSearch` (search file contents), and `readNote` (read full note). This separation makes metadata filtering structurally independent from content search, eliminating an entire class of bugs where filters get dropped in certain code paths (e.g., bug #2267 where `timeRange` was silently ignored when Miyo was active).

## Motivation

The current `localSearch` tool handles too many concerns in a single call:

1. **Time-range filtering** (metadata)
2. **Tag matching** (metadata)
3. **Title matching** (metadata)
4. **Content search** via lexical, semantic, or Miyo backends

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

  sortBy: z.enum(["mtime", "ctime", "title"]).optional()
    .describe("Sort results. Defaults to 'mtime' (most recently modified first)"),

  limit: z.number().optional()
    .describe("Max results to return. Defaults to 50"),
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
    headings: string[];  // H1-H3 headings from metadataCache
  }>;
  totalMatched: number;  // Total files matching filters (before limit)
}
```

**Implementation notes:**
- Built on top of `FilterRetriever` logic but returns metadata objects, not full `Document` objects with content
- Headings come from `app.metadataCache.getFileCache(file)?.headings` - free, no file read needed
- Tags come from `getAllTags(cache)` - also free from metadataCache
- Respects `shouldIndexFile` and `isInternalExcludedFile` exclusion rules
- No dependency on any search backend (Miyo, semantic, lexical)

### Tool 2: `vaultSearch` (content search)

**Purpose:** Search file contents for a topic. Returns matching passages with relevance scores.

**Delegates to the best available backend:** Miyo when active, otherwise local semantic or lexical (via `RetrieverFactory`).

**Schema:**

```typescript
const vaultSearchSchema = z.object({
  query: z.string().min(1)
    .describe("The search query to find relevant content in notes"),

  salientTerms: z.array(z.string())
    .describe("Keywords extracted from the user's query for BM25 matching. Must be from original query."),

  paths: z.array(z.string()).optional()
    .describe("Optional list of file paths to scope search to (from vaultFind results). Max 30 paths."),

  returnAll: z.boolean().optional()
    .describe("Set true for exhaustive search ('find all my X'). Returns up to 100 results."),
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
- Delegates to `RetrieverFactory` which handles Miyo > Semantic > Lexical priority
- The `paths` parameter is implemented as:
  - For Miyo: sent as a path filter to the API (if supported), otherwise post-filter
  - For local retrievers: pre-filter the file set before search
- Capped at 30 paths in the `paths` array. If more files need searching, the agent should narrow scope
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
Agent: vaultSearch(query="machine learning", salientTerms=["machine", "learning"])
     → Present matching passages
```

### 3. "Notes about person A from last week" - Multi-step composition

```
Unix: find ./vault -mtime -7 | xargs grep "person A"
```

```
Agent: getTimeRangeMs("last week")
     → vaultFind(timeRange={...})
     → vaultSearch(query="person A", salientTerms=["person", "A"], paths=[...from vaultFind...])
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
     → vaultSearch(query="budgeting", salientTerms=["budgeting"], paths=[...])
```

### 7. "Everything about AI in my Research folder" - Folder scoping + content

```
Unix: grep -r "AI" ./Research
```

```
Agent: vaultFind(folder="Research")
     → vaultSearch(query="AI", salientTerms=["AI"], paths=[...])
```

### 8. "Compare what I wrote about React vs Vue" - Parallel content searches

```
Unix: grep -r "React" ./vault ; grep -r "Vue" ./vault
```

```
Agent: vaultSearch(query="React", salientTerms=["React"])
     + vaultSearch(query="Vue", salientTerms=["Vue"])   (parallel)
     → Compare results
```

### 9. "Which meeting notes mention John?" - Tag filter then content search

```
Unix: find by tag #meeting | grep "John"
```

```
Agent: vaultFind(tags=["#meeting"])
     → vaultSearch(query="John", salientTerms=["John"], paths=[...])
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
     → vaultSearch(query="budget discussions", salientTerms=["budget", "discussions"], paths=[...from vaultFind...])
     → Summarize matching passages
```

This is the most complex composition pattern — it combines time filtering, folder scoping, AND content search in three distinct steps. With the old monolithic `localSearch`, all three dimensions would be packed into a single call, which is exactly the pattern that caused #2267.

## Agent Instructions

These instructions replace the current `localSearch` custom prompt instructions:

```
## Vault Tools

vaultFind - List files by metadata (time, tags, folder, title).
  Returns: path, title, mtime, tags, headings. No file content.
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
- salientTerms must be extracted from the user's original query - never invent terms
- Preserve the original language - do NOT translate terms to English
- Tags must include '#' prefix: ["#meeting"], not ["meeting"]
- When vaultFind returns many files and you need content, use vaultSearch with paths to narrow scope
- For "find all" requests, use vaultFind to count/list, then vaultSearch with paths if content needed
```

## Migration Plan

### What Gets Replaced

| Current | New | Notes |
|---------|-----|-------|
| `localSearch` tool | `vaultFind` + `vaultSearch` | Monolith split into two focused tools |
| `semanticSearch` tool | Absorbed into `vaultSearch` | Backend selection handled internally |
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
| `RetrieverFactory` | Still handles Miyo > Semantic > Lexical priority for `vaultSearch` |
| `TieredLexicalRetriever` | Backend for `vaultSearch` when lexical mode active |
| `MergedSemanticRetriever` | Backend for `vaultSearch` when semantic mode active |
| `MiyoSemanticRetriever` | Backend for `vaultSearch` when Miyo active |

### Backwards Compatibility

- The `localSearch` tool ID is removed from `BUILTIN_TOOLS` and replaced with `vaultFind` + `vaultSearch`
- Default enabled tool IDs in `constants.ts` are updated to include `vaultFind` and `vaultSearch`
- Users who had `localSearch` enabled in their settings will need a migration to enable the new tools
- The return type of `vaultSearch` preserves `{ type: "local_search", documents: [...] }` for downstream compatibility with CiC formatting, citation rendering, and the "Show Sources" UI

### Settings Migration

Add a settings migration that:
1. If `autonomousAgentEnabledToolIds` contains `"localSearch"`, replace it with `["vaultFind", "vaultSearch"]`
2. Remove `"semanticSearch"` and `"lexicalSearch"` if present (absorbed into `vaultSearch`)

## Implementation Notes

### Key Technical Decisions

1. **`vaultFind` is always local.** It never calls Miyo or any external service. This is the core architectural invariant that prevents the #2267 bug class. Metadata filtering uses `app.vault`, `app.metadataCache`, and `getAllTags()` - all synchronous Obsidian APIs.

2. **`vaultSearch` never filters by metadata.** It only searches content. If you need time-scoped content search, you do `vaultFind(timeRange) → vaultSearch(paths)`. The `paths` parameter is the only way to scope a content search to a subset of files.

3. **The `paths` parameter caps at 30.** This is a pragmatic limit. If `vaultFind` returns more than 30 files, the agent should either narrow scope with tighter filters or work in batches. The agent manages its own context budget.

4. **No Node.js `fs` dependency.** Everything uses Obsidian's vault API for mobile compatibility. `vaultFind` uses `app.vault.getMarkdownFiles()`, `app.metadataCache`, etc.

5. **Content budget is the agent's responsibility.** The tools provide data; the agent decides how much to consume:
   - Small set (10 or fewer files): `readNote` each, then synthesize
   - Medium set (10-30): `vaultSearch` with paths to pull most relevant passages
   - Large set (30+): Agent narrows scope or processes in batches

6. **Both tools use `createLangChainTool()`.** Registered in `ToolRegistry` with appropriate categories. `vaultFind` is category `"search"`, `vaultSearch` is category `"search"`.

7. **`vaultSearch` preserves query expansion.** The `TieredLexicalRetriever` query expansion logic (salient terms, expanded queries, recall terms) is preserved in `vaultSearch` for the reasoning block.

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

## Open Questions

1. **Should `vaultFind` support regex title matching or just substring?** Substring is simpler and sufficient for most cases. Regex adds complexity for marginal benefit.

2. **Should `vaultSearch` accept a `folder` shortcut parameter?** Currently the design says "use `paths` from `vaultFind`", but a `folder` parameter on `vaultSearch` could skip the two-step flow for simple cases like "search in Research folder". Counterargument: keeping `vaultSearch` pure (no metadata logic) is the whole point.

3. **How should `vaultSearch` handle the `paths` parameter for Miyo?** Options:
   - Send paths to Miyo API as a filter (requires API support)
   - Post-filter Miyo results by path membership (simpler, may miss relevant results)
   - Pre-filter the query to only include file names (loses generality)

4. **Should `vaultFind` include a `content` preview (first N characters)?** This would let the agent make better decisions about which files to read, but adds file I/O cost. Headings from metadataCache may be sufficient.

5. **Migration UX:** Should we show a one-time notice to users that `localSearch` has been replaced? Or just silently migrate the settings?
