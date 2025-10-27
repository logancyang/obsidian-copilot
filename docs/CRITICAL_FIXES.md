# Critical Fixes - CiC Formatting & Envelope Guards

## Summary

Fixed two critical issues discovered during legacy removal review:

1. CopilotPlus was incorrectly wrapping smart-referenced content in CiC formatting
2. VaultQA was missing early envelope guard, allowing silent failures

## Issue 1: CopilotPlus CiC Formatting Breaking Smart References

### Problem

After legacy removal, `renderCiCMessage()` was being called for QA-only scenarios (localSearch without other tools), which:

- Wrapped the entire `LayerToMessagesConverter` output in a `Question:` label
- Collapsed the carefully structured L3 smart references into a single "question" string
- Broke the layered formatting contract and smart-reference benefits

**Bad Output**:

```
Question: Context attached:
  - Piano Lessons/project-spec.md
Find them in the Context Library above.

---

[User query]:
What's the project timeline?
```

This treated the entire smart-reference structure as part of the question, breaking the L2/L3 separation.

### Root Cause

Lines 364-378 in `CopilotPlusChainRunner.ts`:

```typescript
const isQAOnly = hasLocalSearchWithResults && !hasOtherTools;

if (hasOtherTools || isQAOnly) {
  // ❌ Wrong - wraps QA-only
  const toolContext = hasOtherTools ? this.formatOtherToolOutputs(otherToolOutputs) : "";
  const shouldLabelQuestion = isQAOnly; // ❌ Adds Question: label

  finalUserContent = renderCiCMessage(
    toolContext,
    userMessageContent.content, // Already properly formatted by converter!
    shouldLabelQuestion
  );
}
```

The `isQAOnly` branch was calling `renderCiCMessage` even though:

- LocalSearch RAG already went to the system message (correct)
- The user message from `LayerToMessagesConverter` was already properly formatted with smart references
- No additional tool context needed wrapping

### Fix

Only use `renderCiCMessage` when we have OTHER tools (non-localSearch):

```typescript
// Only use CiC formatting when we have OTHER tools (non-localSearch)
// LocalSearch goes to system message, so we don't need CiC wrapping
// LayerToMessagesConverter already provides properly formatted L3+L5 with smart references
const hasOtherTools = otherToolOutputs.length > 0;

if (hasOtherTools) {
  // Wrap other tool outputs with user content using CiC format
  const toolContext = this.formatOtherToolOutputs(otherToolOutputs);
  const shouldLabelQuestion = false; // Don't label question when we have tools

  finalUserContent = renderCiCMessage(
    toolContext,
    userMessageContent.content, // L3 smart refs + L5 from converter
    shouldLabelQuestion
  );
} else {
  // No other tools (QA-only or plain chat) - use converter's output as-is
  // Smart references are already properly formatted by LayerToMessagesConverter
  finalUserContent = userMessageContent.content;
}
```

### Result

**Correct Output (QA-only)**:

```
Context attached:
  - Piano Lessons/project-spec.md

Find them in the Context Library above.

---

[User query]:
What's the project timeline?
```

**Correct Output (with other tools)**:

```
# Additional context:

<webSearch>
... web results ...
</webSearch>

Context attached:
  - Piano Lessons/project-spec.md

Find them in the Context Library above.

---

[User query]:
What's the project timeline?
```

Smart references are preserved, L3 structure is maintained, and CiC formatting is only applied when actually needed for tool outputs.

## Issue 2: VaultQA Missing Early Envelope Guard

### Problem

After legacy removal, VaultQAChainRunner was checking envelope late in the flow:

- Envelope extracted at line 47: `const envelope = userMessage.contextEnvelope;`
- Used with optional chaining: `envelope?.layers.find(...)`
- No early guard, so code continued even if envelope was missing
- Would build empty messages array and fail silently with confusing errors

### Root Cause

Lines 42-56 in `VaultQAChainRunner.ts`:

```typescript
try {
  // Tiered lexical retriever doesn't need index check - it builds indexes on demand

  // Step 1: Extract L5 (raw user query) from envelope
  const envelope = userMessage.contextEnvelope;
  const l5User = envelope?.layers.find((l) => l.id === "L5_USER");  // ❌ Optional chaining masks missing envelope
  const rawUserQuery = l5User?.text || userMessage.message;  // Falls back to message

  // ... continues processing even if envelope is missing
}
```

Also had redundant check later at line 139 that would never be reached if envelope was missing earlier.

### Fix

Added early envelope guard at the top of the `run` method:

```typescript
try {
  // Require envelope for VaultQA
  const envelope = userMessage.contextEnvelope;
  if (!envelope) {
    throw new Error(
      "[VaultQA] Context envelope is required but not available. Cannot proceed with VaultQA chain."
    );
  }

  // Step 1: Extract L5 (raw user query) from envelope
  const l5User = envelope.layers.find((l) => l.id === "L5_USER");  // ✅ No optional chaining needed
  const rawUserQuery = l5User?.text || userMessage.message;
```

Also removed redundant check later in the flow.

### Result

- Clear, actionable error if envelope is missing
- Fails fast before attempting RAG retrieval or message construction
- Consistent with LLMChainRunner and CopilotPlusChainRunner patterns
- No silent failures or empty message arrays

## Testing Results

Both fixes verified:

- ✅ **Build**: Successful
- ✅ **Tests**: 1,166 tests passing
- ✅ **Linting**: Clean
- ✅ **TypeScript**: No diagnostics

## Files Modified

1. **src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts**

   - Lines 364-383: Fixed CiC formatting logic
   - Removed `isQAOnly` branch that was wrapping smart references
   - Only use `renderCiCMessage` when we have OTHER tools

2. **src/LLMProviders/chainRunner/VaultQAChainRunner.ts**
   - Lines 45-51: Added early envelope guard
   - Lines 138-143: Removed redundant envelope check
   - Consistent error handling with other chain runners

## Impact

### CopilotPlus Fix

- **Before**: QA-only scenarios had smart references collapsed into `Question:` label
- **After**: Smart references preserved in proper L3 structure
- **Benefit**: L2 Context Library references work correctly, cache stability maintained

### VaultQA Fix

- **Before**: Missing envelope would cause confusing failures with empty messages
- **After**: Clear error message: "Context envelope is required but not available"
- **Benefit**: Fail-fast with actionable error guidance

Both fixes are critical for correct envelope-based context engineering behavior.
