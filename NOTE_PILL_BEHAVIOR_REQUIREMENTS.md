# Note Pill Behavior Requirements

This document defines the expected behavior for Note Pills in the Lexical editor to prevent regressions and ensure consistent user experience.

## Overview

Note Pills are inline decorator nodes that represent references to notes in the format `[[Note Title]]`. They should behave like cohesive units while allowing natural text editing around them.

## Core Behavior Requirements

### 1. Cursor Navigation ✅

- **MUST**: Allow cursor to move past pills using arrow keys
- **MUST**: Cursor should not get "stuck" on pills during navigation
- **IMPLEMENTATION**: `isIsolated(): true` ensures proper cursor navigation

### 2. Text Insertion ✅

- **MUST**: Allow typing text before and after pills
- **MUST**: Pills should not interfere with normal text entry
- **IMPLEMENTATION**: `canInsertTextBefore(): true` and `canInsertTextAfter(): true`

### 3. Pill Deletion Behavior

#### 3.1 Direct Pill Deletion ✅

- **MUST**: When cursor is directly on a pill, backspace/delete should remove the pill
- **CASES**:
  - Backspace when cursor is after the pill (offset 1) → Remove pill
  - Delete when cursor is before the pill (offset 0) → Remove pill

#### 3.2 Backspace After Pill Deletion ✅

- **MUST**: Backspace should always remove the previous pill when positioned after it
- **CASE**: Selection is at paragraph level (element node) with:
  - `isBackward: true`
  - Cursor positioned after a NotePillNode
  - **ACTION**: Remove the pill (regardless of what follows)
- **EXAMPLES**:
  - `"Hello [[Note]]"` + backspace at end → Remove pill
  - `"[[Note]]"` + backspace at end → Remove pill
  - `"Hello [[Note]] World"` + backspace after pill → Remove pill
  - `"[[Note1]] [[Note2]]"` + backspace between → Remove first pill

#### 3.3 Inter-Pill and Adjacent Deletion ✅

- **MUST**: When cursor is positioned between two pills, backspace should remove the previous pill
- **CASE A**: Content like "[[Note1]]|[[Note2]]" where | represents cursor position (paragraph-level)
  - Selection: `anchor.type: "element"`, `anchor.offset > 0`
  - **ACTION**: Remove previous child at `children[anchor.offset - 1]`
- **CASE B**: Content like "[[Note1]]|text" where | represents cursor at start of text
  - Selection: `anchor.type: "text"`, `anchor.offset: 0`
  - **ACTION**: Remove previous sibling if it's a NotePillNode
- **IMPLEMENTATION**: Handle both paragraph-level and text-node-level selections

#### 3.4 Text Deletion Protection ✅

- **MUST NOT**: Deleting regular text characters should NOT accidentally trigger pill deletion
- **CASE**: User deletes individual characters within text content
- **EXPECTED**: Only the text character should be deleted
- **NOTE**: Pills are only deleted when backspace is used specifically adjacent to them

### 4. Selection Behavior ✅

- **MUST**: Pills should be selectable as whole units
- **MUST**: Pills should support range selections that include them
- **IMPLEMENTATION**: `isKeyboardSelectable(): true`

### 5. Visual Behavior ✅

- **MUST**: Pills should render as badges with `[[Note Title]]` format
- **MUST**: Active pills (referencing current note) should have visual indicator
- **MUST**: Pills should be inline elements that flow with text
- **MUST**: Long note titles should truncate with ellipsis (same as context menu badges)
- **IMPLEMENTATION**: Use `tw-max-w-40 tw-truncate` classes for consistent truncation at 160px width

### 6. Typeahead Insertion Behavior ✅

- **MUST**: Automatically add a space after selecting a note from the typeahead
- **PURPOSE**: Improves typing flow so users can continue typing immediately
- **IMPLEMENTATION**: Insert " " after the pill node when selection is made

### 7. Structural Requirements ✅

- **MUST**: Pills are inline nodes (`isInline(): true`)
- **MUST**: Pills cannot be empty (`canBeEmpty(): false`)
- **MUST**: Pills are isolated for navigation (`isIsolated(): true`)

## Test Scenarios

### Scenario 1: End-of-Content Pill Deletion

1. Type: "Hello [[Note]]"
2. Place cursor at the very end (after the pill)
3. Press backspace
4. **EXPECTED**: Pill is deleted, "Hello " remains

### Scenario 1b: Standalone Pill Deletion

1. Create empty editor
2. Insert a note pill (should be only content)
3. Press backspace
4. **EXPECTED**: Pill is deleted

### Scenario 2: Text Deletion Protection

1. Type: "Hello [[Note]] World"
2. Place cursor after "o" in "Hello"
3. Press delete to remove the space
4. **EXPECTED**: Only the space is deleted, pill remains
5. **CURRENT STATUS**: ⚠️ NEEDS TESTING

### Scenario 3: Cursor Navigation

1. Type: "Start [[Note]] End"
2. Place cursor at start
3. Use right arrow to navigate through text
4. **EXPECTED**: Cursor moves smoothly past the pill without getting stuck

### Scenario 4: Direct Pill Deletion

1. Type: "Text [[Note]] More"
2. Click directly on the pill to select it
3. Press backspace or delete
4. **EXPECTED**: Only the pill is deleted, surrounding text remains

### Scenario 5: Automatic Space After Typeahead Selection

1. Type: "Check out [[myno"
2. Select "mynote" from the typeahead menu (Enter or click)
3. **EXPECTED**: Result should be "Check out [[mynote]] " with cursor positioned after the space
4. Continue typing: "for details"
5. **EXPECTED**: Final result should be "Check out [[mynote]] for details"

### Scenario 6: Note Title Truncation

1. Create or reference a note with a very long title (>40 characters)
2. Type: "[[VeryLongNoteNameThatExceedsTheMaximumWidthLimit"
3. Select the note from typeahead
4. **EXPECTED**: The pill should display "[[VeryLongNoteNameThatExceedsTheMa...]]" with ellipsis
5. **EXPECTED**: The truncation should match the behavior of badges in the context menu

### Scenario 7: Backspace Between Pills and Adjacent to Text

1. **Between Two Pills**:
   - Type: "[[FirstNote]] [[SecondNote]]"
   - Place cursor between the two pills (paragraph-level selection)
   - Press backspace
   - **EXPECTED**: First pill deleted, result: " [[SecondNote]]"
2. **Before Text After Pill**:
   - Type: "[[Note]] test"
   - Place cursor at start of "test" (text-node-level selection)
   - Press backspace
   - **EXPECTED**: Pill deleted, result: " test" with cursor before "test"

## Known Issues & Maintenance Notes

### Fixed Issues ✅

- ✅ Backspace not working when note pill is the last node in editor
- ✅ Cursor getting stuck during navigation when `isIsolated(): false`
- ✅ TypeScript errors in deletion handler

### Current Concerns ⚠️

- ⚠️ Text deletion near pills may still trigger pill deletion (needs verification)
- ⚠️ Complex paragraph-level deletion logic may have edge cases

### Architecture Notes

- **Centralized Deletion**: All pill deletion logic is now in `PillDeletionPlugin.tsx` (SCALABLE ARCHITECTURE)
- **Plugin Separation**: Individual pill plugins (like `NotePillPlugin.tsx`) only handle node registration
- **Priority**: Uses `COMMAND_PRIORITY_CRITICAL` for deletion commands to override individual plugin handlers
- **Node Type**: Extends `DecoratorNode<JSX.Element>` for React rendering
- **Pill Detection**: Uses interface-based detection (`IPillNode.isPill()`) to identify all pill types

## Implementation Guidelines

### DO ✅

- **Use PillDeletionPlugin**: All new pill types automatically get deletion handling
- **Implement IPillNode interface**: All pill nodes must implement `isPill(): boolean`
- **Keep individual plugins simple**: Focus only on node definition and rendering
- **Test all scenarios**: Verify deletion works with multiple pill types

### DON'T ❌

- **Don't add deletion logic to individual pill plugins** - use PillDeletionPlugin instead
- **Don't register multiple DELETE_CHARACTER_COMMAND handlers** - causes conflicts
- **Don't make pills non-isolated** (breaks cursor navigation)
- **Don't hardcode specific pill types** in deletion logic - use generic detection

### NEW PILL TYPE CREATION ✅

To add a new pill type (e.g., TagPillNode):

1. **Create the node class**: Extend `DecoratorNode<JSX.Element>` and implement `IPillNode`
2. **Implement interface**: Add `isPill(): boolean { return true; }` method
3. **Register with editor**: Add to `LexicalEditor` nodes array
4. **Create plugin**: Simple plugin like `NotePillPlugin` (no deletion logic needed)
5. **Test**: All deletion behaviors work automatically via `PillDeletionPlugin`

```typescript
// Example: TagPillNode
export class TagPillNode extends DecoratorNode<JSX.Element> implements IPillNode {
  isPill(): boolean {
    return true; // This enables automatic deletion handling
  }
  // ... rest of implementation
}
```

## Regression Prevention

Before making changes to Note Pill behavior:

1. Run all test scenarios listed above
2. Verify cursor navigation works smoothly
3. Test text deletion near pills doesn't remove pills
4. Ensure standalone pill deletion still works
5. Build and test in actual Obsidian environment

## Scalable Architecture Benefits

### Why PillDeletionPlugin is Better

The new centralized architecture provides:

1. **Scalability**: Add unlimited pill types without touching deletion code
2. **Maintainability**: Fix deletion bugs in one place, affects all pill types
3. **Performance**: Single command handler instead of multiple competing handlers
4. **Consistency**: All pills behave identically for deletion operations
5. **Testability**: Test deletion logic once, works for all current and future pills

### Plugin Ordering

```typescript
// In LexicalEditor.tsx - ORDER MATTERS
<NotePillSyncPlugin onNotesChange={onNotesChange} onNotesRemoved={onNotesRemoved} />
<PillDeletionPlugin />        // Must come BEFORE individual pill plugins
<SlashCommandPlugin />
<NoteCommandPlugin />
<NotePillPlugin />           // Individual pill plugins come AFTER
<TagPillPlugin />           // Future pill plugins work automatically
```

## Future Enhancements

Potential improvements that maintain backward compatibility:

- Add more pill types (TagPillNode, UserPillNode, etc.) - deletion works automatically
- Bulk pill deletion utilities via `PillDeletionPlugin`
- Keyboard shortcuts for pill manipulation
- Improved visual feedback during selection
- Better integration with Obsidian's link handling
- Custom pill detection logic via interface implementation
