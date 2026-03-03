# TODO - UI Rendering Performance Issues

This document tracks UI rendering performance issues identified through a comprehensive audit of the React component tree, state management, and streaming paths. Findings are ranked by severity and organized by recommended fix priority.

## Severity Legend

- **CRITICAL** - Causes visible jank/stalls during normal usage; affects every user
- **HIGH** - Causes noticeable stalls in specific scenarios or degrades with scale
- **MEDIUM** - Contributes to cumulative performance degradation
- **LOW** - Minor inefficiency; fix opportunistically

---

## 1. [TODO] ChatSingleMessage Not Memoized — Streaming Re-renders All Historical Messages (CRITICAL)

### Issue Description

`ChatSingleMessage` is the most expensive component in the application yet is not wrapped in `React.memo`. Every streaming token update causes ALL historical messages to re-render with full MarkdownRenderer passes and DOM manipulation.

### Technical Details

- **Files**: `src/components/chat-components/ChatSingleMessage.tsx`, `src/components/chat-components/ChatMessages.tsx:88-115`
- **Root Cause**: When `ChatMessages` (which IS memoized) re-renders due to `currentAiMessage` changing during streaming, the `.map()` at line 88 creates new React elements for ALL historical messages. Each gets new inline closure props:
  - `() => onRegenerate(index)` (line 108)
  - `(newMessage) => onEdit(index, newMessage)` (line 109)
  - `() => onDelete(index)` (line 110)
- These inline closures create new function references on every render, which would defeat `React.memo` even if it were added without also stabilizing the callbacks.
- `ChatSingleMessage` contains: `MarkdownRenderer.renderMarkdown()`, DOM manipulation (`querySelectorAll`, `createElement`, `insertBefore`), `parseToolCallMarkers()`, multiple regex passes, and multiple `useEffect` hooks.

### Recommended Solution

1. Wrap `ChatSingleMessage` in `React.memo` with a custom comparator that checks `message.id`, `message.message`, `isStreaming`, and callback identity.
2. Replace inline closure callbacks in `ChatMessages.map()` with stable references. Options:
   - Pass `messageIndex` as a prop and let `ChatSingleMessage` call `onRegenerate(messageIndex)` internally.
   - Use `useCallback` with a ref-based pattern to avoid `chatHistory` dependency (see Finding #9).

### Impact

- **Affects**: Every LLM response stream for every user.
- **Severity scales with**: Conversation length. A 20-message conversation means 20 unnecessary expensive re-renders per animation frame during streaming.
- **Expected improvement**: Eliminating historical message re-renders during streaming would be the single largest performance win in the codebase.

---

## 2. [TODO] O(N^2) Filter Inside .map() in ChatMessages (CRITICAL)

### Issue Description

`chatHistory.filter()` is called inside the `.map()` callback on every iteration, creating O(N^2) complexity per render.

### Technical Details

- **File**: `src/components/chat-components/ChatMessages.tsx:89`
- **Code**: `const visibleMessages = chatHistory.filter((m) => m.isVisible);` is called inside `.map()` to compute `isLastMessage`. For N messages, this executes N filter operations of O(N) each = O(N^2).
- Combined with Finding #1 (re-renders on every streaming frame), this compounds badly.

### Recommended Solution

Hoist the filter before the `.map()`:

```tsx
const visibleMessages = useMemo(() => chatHistory.filter((m) => m.isVisible), [chatHistory]);
// Then use visibleMessages.length inside .map()
```

### Impact

- **Affects**: Every render during streaming.
- **For 100 messages**: 10,000 filter operations per render frame.
- **Fix effort**: Trivial — single-line hoist.

---

## 3. [TODO] ChatManager.getCurrentMessageRepo() Creates New ChatPersistenceManager on Every Call (HIGH)

### Issue Description

A new `ChatPersistenceManager` object is allocated on every call to `getCurrentMessageRepo()`, which is invoked by virtually every read/write operation.

### Technical Details

- **File**: `src/core/ChatManager.ts:82-87`
- **Code**: `this.persistenceManager = new ChatPersistenceManager(this.plugin.app, currentRepo, this.chainManager)` runs unconditionally inside `getCurrentMessageRepo()`.
- This method is called by `getDisplayMessages()`, `getLLMMessages()`, `getMessage()`, `addMessage()`, `deleteMessage()`, etc.
- Via `useChatManager`, `getDisplayMessages()` is called on every subscription notification from `ChatUIState`.

### Recommended Solution

Cache the `ChatPersistenceManager` per project key. Only recreate when the project actually changes:

```typescript
if (!this.persistenceManagers.has(projectKey)) {
  this.persistenceManagers.set(projectKey, new ChatPersistenceManager(...));
}
```

### Impact

- **Affects**: Every message operation (read or write).
- **Causes**: Unnecessary object allocation and GC pressure on every render cycle.

---

## 4. [TODO] useChatManager Creates New Array Reference on Every State Notification (HIGH)

### Issue Description

`useChatManager` always spreads into a new array, meaning React always sees a new `messages` reference, defeating downstream memoization.

### Technical Details

- **File**: `src/hooks/useChatManager.ts:21`
- **Code**: `setMessages([...chatUIState.getMessages()])` — the spread operator always creates a new array reference regardless of whether the content has changed.
- Every `notifyListeners()` call (from any message operation) triggers this, causing `ChatMessages` to re-render even if the actual messages haven't changed.

### Recommended Solution

Use structural comparison or a version counter to avoid unnecessary state updates:

```typescript
const unsubscribe = chatUIState.subscribe(() => {
  const next = chatUIState.getMessages();
  setMessages((prev) => {
    // Only update if messages actually changed
    if (
      prev.length === next.length &&
      prev.every((m, i) => m.id === next[i].id && m.message === next[i].message)
    ) {
      return prev;
    }
    return [...next];
  });
});
```

Alternatively, add a version/generation counter to `MessageRepository` and only spread when the version changes.

### Impact

- **Affects**: Every state change cascades into unnecessary `ChatMessages` re-renders.
- **Compounds with**: Finding #1 (unmemoized ChatSingleMessage) and Finding #9 (unstable callback deps).

---

## 5. [TODO] useChatScrolling Triggers Expensive DOM Queries on Every chatHistory Change (HIGH)

### Issue Description

`calculateDynamicMinHeight` performs DOM queries (`querySelector`, `getBoundingClientRect`) and is called on every `chatHistory` change, causing layout thrashing during streaming.

### Technical Details

- **File**: `src/hooks/useChatScrolling.ts:29-66, 109-114`
- `calculateDynamicMinHeight` has `chatHistory` in its dependency array, so it changes identity on every message update.
- The `useEffect` at line 109 calls it on every `chatHistory` change.
- It does `querySelector` + `getBoundingClientRect`, which forces browser layout recalculation (reflow).
- Since `chatHistory` gets a new reference frequently (Finding #4), this triggers expensive layout recalculations very often.

### Recommended Solution

1. Debounce or throttle `calculateDynamicMinHeight` calls (e.g., only recalculate on user message additions, not during streaming).
2. Decouple from `chatHistory` array identity — use `chatHistory.length` or a message count instead.
3. Consider using `ResizeObserver` on the last message element rather than querying on every state change.

### Impact

- **Affects**: Every message update during streaming.
- **Causes**: Layout thrashing (forced reflows) on the main thread.

---

## 6. [TODO] useAllNotes Sorts Entire File List on Every Vault Change (HIGH)

### Issue Description

The `useAllNotes` hook sorts all vault files by creation date inside `useMemo`, triggered on every debounced vault event.

### Technical Details

- **File**: `src/components/chat-components/hooks/useAllNotes.ts:36`
- **Code**: `files.sort((a, b) => b.stat.ctime - a.stat.ctime)` runs inside `useMemo` with `[allNotes, isCopilotPlus]` deps.
- `allNotes` atom gets a new array reference on every debounced vault event (`VaultDataManager.refreshNotes` at `vaultDataAtoms.ts:214` always sets a new array).
- For vaults with 5000+ files, this is O(N log N) on every file create/delete/rename.

### Recommended Solution

Move sorting into `VaultDataManager.refreshNotes()` so it happens once at the source, not in every consumer. Or pre-sort the atom value.

### Impact

- **Affects**: Users with large vaults (5000+ files).
- **Triggers**: On every file create/delete/rename in the vault (debounced at 250ms).

---

## 7. [TODO] Loading Dots Animation Triggers Full ChatMessages Re-render Every 200ms (MEDIUM)

### Issue Description

The loading dots animation uses internal state (`setLoadingDots`) that triggers `ChatMessages` re-renders every 200ms, which cascades to all child message components.

### Technical Details

- **File**: `src/components/chat-components/ChatMessages.tsx:49-59`
- A `setInterval` at 200ms calls `setLoadingDots()`, updating internal state of the `memo`-wrapped `ChatMessages`.
- Internal state changes bypass `React.memo`, causing the entire message list to re-render.
- Combined with Finding #1, all historical `ChatSingleMessage` children re-render too.

### Recommended Solution

Extract the loading dots into a separate small component that manages its own state:

```tsx
const LoadingDots: React.FC = () => {
  const [dots, setDots] = useState("");
  useEffect(() => {
    /* interval logic */
  }, []);
  return <span>{dots}</span>;
};
```

This isolates the 200ms re-renders to just the loading indicator, not the entire message list.

### Impact

- **Affects**: Every loading phase (waiting for AI response).
- **Causes**: 5 unnecessary full-tree re-renders per second during loading.

---

## 8. [TODO] VaultDataManager Tag Refresh Scans All Markdown Files (MEDIUM)

### Issue Description

`refreshTagsFrontmatter()` and `refreshTagsAll()` each iterate over ALL markdown files, and both are triggered independently on every file modify/metadata change.

### Technical Details

- **File**: `src/state/vaultDataAtoms.ts:234-271`
- Both methods call `app.vault.getMarkdownFiles()` and iterate with `getTagsFromNote()` on each file.
- Both are triggered by `handleFileModify` and `handleMetadataChange` events (debounced at 250ms).
- For a vault with 5000 markdown files, this means two full vault scans on every file save.

### Recommended Solution

1. Merge the two refresh methods into a single pass that computes both frontmatter and all tags simultaneously.
2. Consider incremental tag updates — only recompute tags for the changed file, not the entire vault.

### Impact

- **Affects**: Users with large vaults.
- **Triggers**: On every file save (after 250ms debounce).
- **Usually mitigated by**: Debouncing. But for very large vaults, even one scan can take 50-100ms.

---

## 9. [TODO] Chat.tsx Callback Dependencies Include chatHistory Array (MEDIUM)

### Issue Description

`handleRegenerate`, `handleEdit`, and `handleDelete` in `Chat.tsx` all depend on `chatHistory` in their `useCallback` dependency arrays, causing them to be recreated on every render and defeating `ChatMessages`'s `React.memo`.

### Technical Details

- **File**: `src/components/Chat.tsx:421-472, 474-550, 664-683`
- These callbacks access `chatHistory[messageIndex]` to get the message to operate on.
- Since `chatHistory` gets a new array reference on every state update (Finding #4), these callbacks are recreated on every render.
- They're passed as props to `ChatMessages` (which is memoized), but new callback references trigger re-renders regardless.

### Recommended Solution

Use a ref to hold the latest `chatHistory` and access it inside the callbacks:

```typescript
const chatHistoryRef = useRef(chatHistory);
chatHistoryRef.current = chatHistory;

const handleRegenerate = useCallback(
  (messageIndex: number) => {
    const message = chatHistoryRef.current[messageIndex];
    // ... rest of logic
  },
  [
    /* stable deps only */
  ]
);
```

This keeps the callback identity stable while always reading the latest data.

### Impact

- **Affects**: Effectively defeats the `React.memo` on `ChatMessages`, compounding with Finding #1.

---

## 10. [TODO] ChatSingleMessage DOM Manipulation in useEffect During Streaming (MEDIUM)

### Issue Description

The main rendering `useEffect` in `ChatSingleMessage` performs extensive synchronous DOM operations on every `message` prop change, which during streaming happens on every RAF tick.

### Technical Details

- **File**: `src/components/chat-components/ChatSingleMessage.tsx:533-723`
- Operations include: `querySelectorAll`, `createElement`, `insertBefore`, `appendChild`, `remove`, `MarkdownRenderer.renderMarkdown()`.
- During streaming, only the streaming `ChatSingleMessage` instance does this work (historical messages would too, per Finding #1, but they should not be receiving new props).
- The `preprocess` callback (line 246) runs multiple regex replacements and string splitting on every update.

### Recommended Solution

1. Fix Finding #1 first — this eliminates DOM manipulation for historical messages during streaming.
2. For the streaming message, consider differential updates (only re-render new content appended since last frame) rather than re-processing the entire message on every token.

### Impact

- **Affects**: Streaming message rendering.
- **Mostly contained**: After fixing Finding #1, only one component instance does this work per frame.

---

## 11. [TODO] ChatSingleMessage preprocess: Repeated Regex Splitting (MEDIUM)

### Issue Description

The `replaceLinks` helper splits the message by code blocks using a regex, then runs further regex replacements on each part. This happens twice per render (once for images, once for links).

### Technical Details

- **File**: `src/components/chat-components/ChatSingleMessage.tsx:378-395`
- **Code**: `text.split(/(```[\s\S]*?```|`[^`]\*`)/g)` creates an array of code/non-code segments, then regex replacement runs on each non-code segment. Called twice in the preprocessing pipeline.
- For long AI responses with many code blocks, this is O(parts x content_length) per call.

### Recommended Solution

Split the content into code/non-code segments once, then apply all transformations to the non-code segments in a single pass.

### Impact

- **Affects**: Long AI responses during streaming.
- **Severity scales with**: Message length and number of code blocks.

---

## 12. [TODO] Missing React.memo on Frequently-Rendered Leaf Components (LOW)

### Issue Description

Several leaf components that render frequently due to parent re-renders are not wrapped in `React.memo`.

### Technical Details

- **ChatButtons** (`src/components/chat-components/ChatButtons.tsx`): Renders for every message, receives callbacks that change on parent re-render.
- **MessageContext** (`src/components/chat-components/ChatSingleMessage.tsx:85`): Renders context badges for each message.
- **ChatHistoryItem** (`src/components/chat-components/ChatHistoryPopover.tsx:349`): Receives `confirmDeleteId` which changes for all items on any delete confirmation.

### Recommended Solution

Wrap each in `React.memo`. For `ChatHistoryItem`, consider passing only a boolean `isConfirmingDelete` instead of the full `confirmDeleteId` to reduce unnecessary re-renders.

### Impact

- **Individually negligible**, but compounds with other findings.

---

## 13. [TODO] useAtMentionSearch Eagerly Creates React Elements for All Vault Items (LOW)

### Issue Description

The `noteItems`, `folderItems`, and `webTabItems` memos create `React.createElement` for icon components on every item, even when the typeahead menu is not open.

### Technical Details

- **File**: `src/components/chat-components/hooks/useAtMentionSearch.ts:45-113`
- For vaults with 5000+ notes, this creates 5000+ React elements on mount.
- The `useMemo` deps include `allNotes` which changes on every vault event.

### Recommended Solution

Defer icon element creation to render time (pass icon component type instead of element instance), or only compute items when the typeahead is open.

### Impact

- **Affects**: Initial mount time and memory in large vaults.
- **Mitigated by**: `useMemo` — only recomputes when deps change.

---

## 14. [TODO] ChatHistoryPopover ChatHistoryItem Not Memoized (LOW)

### Issue Description

`ChatHistoryItem` receives several props that change across all items when any single item is being edited or deleted.

### Technical Details

- **File**: `src/components/chat-components/ChatHistoryPopover.tsx:349-486`
- `confirmDeleteId` changes for all items when any delete is confirmed.
- `editingTitle` changes on every keystroke during editing.
- All items re-render when either of these change.

### Recommended Solution

Wrap `ChatHistoryItem` in `React.memo`. Pass derived booleans (`isConfirmingDelete`, `isEditing`) instead of global IDs.

### Impact

- **Mitigated by**: Pagination (max 50 items rendered at a time).
- **Nearly negligible** with current architecture.

---

## Good Patterns Already in Place

These patterns were identified as already well-implemented:

- **RAF-throttled streaming**: `useRafThrottledCallback` properly throttles streaming text updates to animation frames
- **ChatMessages memo**: The top-level `ChatMessages` is wrapped in `React.memo` (though currently defeated by unstable props — see Findings #1, #4, #9)
- **Pagination in ChatHistoryPopover**: IntersectionObserver-based infinite scroll prevents rendering all history at once
- **VaultDataManager debouncing**: 250ms debounce on vault events prevents rapid-fire re-scans
- **useLayoutEffect for pagination reset**: Prevents one-frame render spike when popover opens
- **RelevantNotes memo**: Properly memoized with `React.memo`
- **Streaming message isolation**: The streaming message uses a separate `ChatSingleMessage` instance with a stable key, preventing full list re-keying

---

## Recommended Fix Priority Order

| Priority | Finding                                            | Effort     | Expected Impact                            |
| -------- | -------------------------------------------------- | ---------- | ------------------------------------------ |
| P0       | #1 Memoize ChatSingleMessage + stabilize callbacks | Medium     | Eliminates streaming jank                  |
| P0       | #2 Hoist filter out of .map()                      | Trivial    | O(N^2) -> O(N) per render                  |
| P1       | #9 Stabilize Chat.tsx callback dependencies        | Small      | Unbreaks ChatMessages memo                 |
| P1       | #4 Stabilize chatHistory array reference           | Small      | Prevents cascading re-renders              |
| P1       | #7 Extract loading dots component                  | Trivial    | Eliminates 5 re-renders/sec during loading |
| P2       | #3 Cache ChatPersistenceManager                    | Trivial    | Reduces GC pressure                        |
| P2       | #5 Decouple scroll calculation from chatHistory    | Small      | Eliminates layout thrashing                |
| P2       | #6 Pre-sort notes in VaultDataManager              | Trivial    | Reduces sort cost in large vaults          |
| P3       | #8 Merge tag refresh into single pass              | Small      | Halves vault scan frequency                |
| P3       | #10-14 Remaining medium/low items                  | Small each | Incremental improvements                   |

---

_Last updated: 2026-03-03_
