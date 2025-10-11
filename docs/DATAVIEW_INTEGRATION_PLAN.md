# Dataview Integration Plan

## Goal

Enable Copilot to see the rendered results of Dataview blocks when notes containing them are included as context (active note or context notes).

## Complexity Assessment

**Medium Complexity** - This is achievable but requires careful integration with the Dataview plugin API.

### Key Requirements

1. **Dataview Plugin Integration**: Access Dataview's public API to execute queries
2. **Block Detection & Parsing**: Identify Dataview blocks in markdown (`dataview, `dataviewjs, inline queries)
3. **Result Rendering**: Convert Dataview's output (tables, lists, task lists) into LLM-readable text
4. **Async Handling**: Dataview queries can be async and may take time to execute

## Implementation Plan

### Phase 1: Dataview Detection & API Access

**Location**: New utility file or within `contextProcessor.ts`

**Tasks**:

- Check if Dataview plugin is installed and enabled via `app.plugins.plugins['dataview']`
- Access Dataview's public API
- Create graceful fallback if Dataview is not available
- Document Dataview API methods we'll use

**Code Pattern**:

```typescript
const dataviewPlugin = app.plugins.plugins["dataview"];
if (!dataviewPlugin) {
  // Fallback: return content as-is
  return content;
}
const dataviewApi = dataviewPlugin.api;
```

### Phase 2: Block Detection

**Location**: `src/contextProcessor.ts` - new method

**Method Signature**:

```typescript
async processDataviewBlocks(
  content: string,
  sourcePath: string,
  vault: Vault
): Promise<string>
```

**Detect**:

1. **Codeblock queries**:

   - ` ```dataview` ... ` ``` `
   - ` ```dataviewjs` ... ` ``` `

2. **Inline queries**:
   - `` `= dv.pages()...` ``
   - `` `$= ...` ``

**Detection Strategy**:

- Use regex to find all Dataview blocks
- Extract query content and type
- Preserve surrounding content structure

### Phase 3: Query Execution & Result Formatting

**For each detected Dataview block**:

1. **Execute the query** using Dataview API
2. **Format results** based on output type:
   - **Tables** → Markdown tables or structured text
   - **Lists** → Bulleted/numbered lists
   - **Tasks** → Task lists with [ ] and [x] status
   - **Single values** → Plain text
   - **Calendar/Timeline** → Descriptive text representation

**Output Format**:

```xml
<dataview_block>
<query_type>dataview|dataviewjs</query_type>
<original_query>
[original query code]
</original_query>
<executed_result>
[formatted results]
</executed_result>
</dataview_block>
```

### Phase 4: Integration into Context Processing

**Location**: `src/contextProcessor.ts:109` - within `processNote` function

**Integration Point**:

```typescript
// Current code
let content = await fileParserManager.parseFile(note, vault);

// NEW: Process Dataview blocks if present
if (note.extension === "md") {
  content = await this.processDataviewBlocks(content, note.path, vault);
}

// Special handling for embedded PDFs within markdown (only in Plus mode)
if (note.extension === "md" && isPlusChain(currentChain)) {
  content = await this.processEmbeddedPDFs(content, vault, fileParserManager);
}
```

### Phase 5: Error Handling

**Handle gracefully**:

- Dataview plugin not installed → Skip processing
- Malformed queries → Show error message + original block
- Slow queries → Implement timeout (e.g., 5 seconds per query)
- Query execution errors → Show error + original block
- Empty results → Indicate "No results found"

**Error Format**:

```xml
<dataview_block>
<query_type>dataview</query_type>
<original_query>
[original query code]
</original_query>
<error>Query execution failed: [error message]</error>
</dataview_block>
```

## Estimated Effort

- **Core implementation**: 100-150 lines of code
- **Testing**: 2-3 hours across different query types
- **Documentation**: Update CLAUDE.md with Dataview support notes
- **Total time**: 4-6 hours

## Key Challenges

### 1. Dataview API Structure

- Need to understand Dataview's public API methods
- Different methods for different query types (DQL vs DataviewJS)
- API may differ across Dataview versions

### 2. Result Formatting

- Converting complex nested data structures into readable text
- DataviewJS can return arbitrary JavaScript objects
- Maintaining readability for LLMs

### 3. Performance

- Dataview queries can be slow on large vaults
- Multiple queries in one note could cause delays
- Need timeout mechanisms to prevent blocking

### 4. Query Context

- Dataview queries execute in the context of the source note
- Need to pass correct file path for `this.file` references
- Date-based queries need current date context

## Testing Checklist

- [ ] Basic LIST query
- [ ] Basic TABLE query
- [ ] TASK query with completion status
- [ ] DataviewJS query
- [ ] Inline queries (`` `= ...` ``)
- [ ] Multiple Dataview blocks in one note
- [ ] Queries with filters and sorting
- [ ] Queries referencing `this.file`
- [ ] Empty result sets
- [ ] Malformed queries (error handling)
- [ ] Performance with slow queries
- [ ] Behavior when Dataview plugin is disabled

## Benefits

1. **Enhanced Context Awareness**: Users can ask questions about dynamically generated content
2. **No UI Changes Required**: Works seamlessly with existing Copilot features
3. **Transparent Integration**: Users don't need to change their workflow
4. **Better Insights**: LLM can understand aggregated data, not just raw notes

## Future Enhancements

1. **Query Result Caching**: Cache results for repeated queries in same session
2. **Selective Processing**: Allow users to enable/disable Dataview processing via settings
3. **Result Summarization**: For very large result sets, provide summaries instead of full output
4. **Real-time Updates**: Reflect Dataview query updates when vault changes during chat session

## Related Files

- `src/contextProcessor.ts` - Main integration point
- `src/core/ContextManager.ts` - Orchestrates context processing
- `src/tools/FileParserManager.ts` - File parsing utilities
- `docs/CLAUDE.md` - Documentation updates needed

## References

- [Dataview Plugin API Documentation](https://blacksmithgu.github.io/obsidian-dataview/)
- [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api)
