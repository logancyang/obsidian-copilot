# TODO: Composer Tool Redesign for Faster Feedback

**Date:** 2026-02-04
**Assignee:** @wenzhengjiang
**Status:** TODO

## Problem

The `writeToFile` and `replaceInFile` composer tools have a significant UX issue: there's a **30+ second gap** between the initial reasoning step and any meaningful feedback about what the agent intends to do.

### Root Cause

The current flow requires the model to generate the **entire modified file content** in a single tool call:

```
User: "Remove all the headings"
         ↓
Model receives prompt + full file content
         ↓
Model generates ENTIRE modified file (30+ seconds)
         ↓
Tool call emitted with full content
         ↓
UI finally shows "Writing to filename..."
```

During those 30+ seconds, the user has no idea what the agent is planning to do.

### Current Tool Schema

```typescript
writeToFile({
  path: string,
  content: string | object, // ← ENTIRE file content generated upfront
  confirmation: boolean,
});
```

## Proposed Solution: Multi-Step Tool Design

Split the composer operation into two phases:

### Phase 1: Intent Declaration (Fast)

A lightweight tool call that declares intent without generating content:

```typescript
declareEditIntent({
  path: string,
  operation: "rewrite" | "modify" | "create",
  description: string, // e.g., "Remove all headings from the document"
});
```

This would return almost immediately (1-2 seconds) because the model only needs to decide WHAT to do, not generate the full content.

**UI shows:** "Planning to remove all headings from Daily-AI-Digest.md..."

### Phase 2: Content Generation (Slow but expected)

After intent is confirmed, the full content generation happens:

```typescript
executeEdit({
  path: string,
  content: string | object,
});
```

**UI shows:** "Generating changes..." → "Writing to filename..."

### Benefits

1. **Immediate feedback**: User knows the intent within 1-2 seconds
2. **Opportunity to cancel**: User can abort before expensive generation
3. **Better UX**: Progress feels natural (planning → executing)
4. **Clearer reasoning steps**: Each phase has distinct, meaningful steps

## Additional Requirements

### Diff History Cache for Reliable Revert

Cache the last N diffs per file to enable reliable undo/revert functionality:

- Store diffs (not full file snapshots) to minimize storage
- Keep last N changes (e.g., N=10) per file path
- Enable "Revert last change" and "Revert to version X" actions
- Clear old diffs when limit exceeded (FIFO)

```typescript
interface DiffHistoryEntry {
  timestamp: number;
  path: string;
  diff: Change[]; // from 'diff' library
  description: string; // e.g., "Remove all headings"
}
```

### Dedicated "Apply" Model

Consider using a separate small, fast, and cheap model specifically for applying diffs:

- **Main model**: Generates the intent and edit description (Phase 1)
- **Apply model**: Executes the actual file transformation (Phase 2)

Benefits:

- Faster execution for Phase 2 (smaller model = faster inference)
- Lower cost (cheap model for mechanical transformation)
- Main model focuses on understanding, apply model focuses on execution
- Could use a fine-tuned model optimized for code/text transformations

Candidates: Gemini Flash Lite or comparable models.

## Related Files

- `src/tools/ComposerTools.ts` - Current tool implementations
- `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts` - ReAct loop
- `src/LLMProviders/chainRunner/utils/AgentReasoningState.ts` - Reasoning UI state

## Next Steps

1. Design the multi-step tool API
2. Prototype with `writeToFile` first
3. Update reasoning UI to handle two-phase operations
4. Test with various file sizes and operations
5. Roll out to `replaceInFile`
