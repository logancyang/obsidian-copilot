# Agent Reasoning Block Implementation Plan

## Overview

Replace the current tool call banner with a new **Agent Reasoning Block** - a multi-line collapsible block that shows the agent's reasoning process during execution, then collapses to "Thought for N s" during final response streaming.

---

## Design Reference

**During Agent Loop (Expanded):**

```
┌──────────────────────────────────────────────────┐
│ ⠿ Reasoning · 9s                                 │
│                                                  │
│ • Searching notes for "machine learning"         │
│ • Found 5 relevant notes, analyzing content      │
└──────────────────────────────────────────────────┘
```

**During Final Response (Collapsed):**

```
┌──────────────────────────────────────────────────┐
│ ▸ Thought for 12s                                │
└──────────────────────────────────────────────────┘
```

**After Response Complete (Expandable):**

```
┌──────────────────────────────────────────────────┐
│ ▸ Thought for 12s                [click to expand] │
└──────────────────────────────────────────────────┘
```

---

## Naming

| Term                      | Description                                  |
| ------------------------- | -------------------------------------------- |
| **Agent Reasoning Block** | The full UI component                        |
| **Reasoning Steps**       | Individual bullet points (1-2 per iteration) |
| **Reasoning Timer**       | Elapsed seconds counter                      |

---

## Architecture

### State Machine

```
┌─────────────┐     tool call      ┌─────────────┐
│   IDLE      │ ────────────────▶  │  REASONING  │
└─────────────┘                    └─────────────┘
                                         │
                                         │ final response starts
                                         ▼
                                   ┌─────────────┐
                                   │  COLLAPSED  │
                                   └─────────────┘
                                         │
                                         │ response complete
                                         ▼
                                   ┌─────────────┐
                                   │  COMPLETE   │
                                   └─────────────┘
```

### Data Flow

```
AutonomousAgentChainRunner
    │
    ├── onReasoningStart(timestamp)
    │       └── Start timer, set state = REASONING
    │
    ├── onReasoningStep(summary: string)
    │       └── Add bullet point to steps array
    │
    ├── onReasoningEnd()
    │       └── Set state = COLLAPSED, stop timer
    │
    └── Final streaming via updateCurrentAiMessage
            └── Normal text streaming (block stays collapsed)
```

---

## Implementation Phases

### Phase 1: Data Model & State

**File:** `src/LLMProviders/chainRunner/utils/AgentReasoningState.ts` (new)

```typescript
export interface ReasoningStep {
  timestamp: number;
  summary: string; // e.g., "Searching notes for 'AI'"
  toolName?: string;
}

export interface AgentReasoningState {
  status: "idle" | "reasoning" | "collapsed" | "complete";
  startTime: number | null;
  elapsedSeconds: number;
  steps: ReasoningStep[];
}

export function createInitialReasoningState(): AgentReasoningState {
  return {
    status: "idle",
    startTime: null,
    elapsedSeconds: 0,
    steps: [],
  };
}

// Serialize to marker format (embedded in message)
export function serializeReasoningBlock(state: AgentReasoningState): string {
  const data = {
    elapsed: state.elapsedSeconds,
    steps: state.steps.map((s) => s.summary),
  };
  return `<!--REASONING_BLOCK:${JSON.stringify(data)}-->`;
}

// Parse from marker format
export function parseReasoningBlock(marker: string): { elapsed: number; steps: string[] } | null {
  const match = marker.match(/<!--REASONING_BLOCK:(.+?)-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
```

### Phase 2: Update AutonomousAgentChainRunner

**File:** `src/LLMProviders/chainRunner/AutonomousAgentChainRunner.ts`

**Changes:**

1. Add reasoning state tracking:

```typescript
private reasoningState: AgentReasoningState = createInitialReasoningState();
private reasoningTimerInterval: NodeJS.Timeout | null = null;
```

2. Add helper methods:

```typescript
private startReasoningTimer(updateFn: (message: string) => void): void {
  this.reasoningState = {
    status: 'reasoning',
    startTime: Date.now(),
    elapsedSeconds: 0,
    steps: [],
  };

  // Update every 100ms for responsive timer
  this.reasoningTimerInterval = setInterval(() => {
    if (this.reasoningState.startTime) {
      this.reasoningState.elapsedSeconds = Math.floor(
        (Date.now() - this.reasoningState.startTime) / 1000
      );
      // Emit updated reasoning block
      updateFn(this.buildReasoningBlockMarkup());
    }
  }, 100);
}

private addReasoningStep(summary: string): void {
  // Keep only last 2 steps for concise display
  this.reasoningState.steps.push({
    timestamp: Date.now(),
    summary,
  });
  if (this.reasoningState.steps.length > 2) {
    this.reasoningState.steps.shift();
  }
}

private stopReasoningTimer(): void {
  if (this.reasoningTimerInterval) {
    clearInterval(this.reasoningTimerInterval);
    this.reasoningTimerInterval = null;
  }
  this.reasoningState.status = 'collapsed';
}

private buildReasoningBlockMarkup(): string {
  const { status, elapsedSeconds, steps } = this.reasoningState;

  if (status === 'idle') return '';

  // Use special marker that ChatSingleMessage will parse
  const stepsJson = JSON.stringify(steps.map(s => s.summary));
  return `<!--AGENT_REASONING:${status}:${elapsedSeconds}:${stepsJson}-->`;
}
```

3. Integrate into agent loop:

```typescript
async run(...) {
  // Start reasoning timer at beginning
  this.startReasoningTimer(updateCurrentAiMessage);

  try {
    // ... agent loop ...

    // When executing a tool:
    this.addReasoningStep(`Calling ${toolName}...`);
    updateCurrentAiMessage(this.buildReasoningBlockMarkup());

    // After tool result:
    this.addReasoningStep(this.summarizeToolResult(toolName, result));
    updateCurrentAiMessage(this.buildReasoningBlockMarkup());

    // When final response starts:
    this.stopReasoningTimer();
    const collapsedBlock = this.buildReasoningBlockMarkup();

    // Stream final response AFTER the collapsed block
    for await (const chunk of stream) {
      updateCurrentAiMessage(collapsedBlock + chunk);
    }

  } finally {
    this.stopReasoningTimer();
  }
}
```

4. Add step summarization helper:

```typescript
private summarizeToolResult(toolName: string, result: any): string {
  switch (toolName) {
    case 'localSearch':
      const count = result?.documents?.length || 0;
      return `Found ${count} relevant note${count !== 1 ? 's' : ''}`;
    case 'webSearch':
      return 'Retrieved web search results';
    case 'getTimeRangeMs':
      return 'Calculated time range';
    default:
      return `Completed ${toolName}`;
  }
}
```

### Phase 3: React Component

**File:** `src/components/chat-components/AgentReasoningBlock.tsx` (new)

```tsx
import React, { useState, useEffect, useRef } from "react";

interface AgentReasoningBlockProps {
  status: "reasoning" | "collapsed" | "complete";
  elapsedSeconds: number;
  steps: string[];
  isStreaming: boolean;
}

export const AgentReasoningBlock: React.FC<AgentReasoningBlockProps> = ({
  status,
  elapsedSeconds,
  steps,
  isStreaming,
}) => {
  const [isExpanded, setIsExpanded] = useState(status === "reasoning");

  // Auto-collapse when status changes to collapsed
  useEffect(() => {
    if (status === "collapsed" || status === "complete") {
      setIsExpanded(false);
    } else if (status === "reasoning") {
      setIsExpanded(true);
    }
  }, [status]);

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const isActive = status === "reasoning";

  return (
    <div className="agent-reasoning-block">
      {/* Header - always visible */}
      <div
        className="agent-reasoning-header"
        onClick={() => !isActive && setIsExpanded(!isExpanded)}
        style={{ cursor: isActive ? "default" : "pointer" }}
      >
        {/* Spinner or expand chevron */}
        <span className="agent-reasoning-icon">
          {isActive ? (
            <LoadingSpinner />
          ) : (
            <span className={`chevron ${isExpanded ? "expanded" : ""}`}>▸</span>
          )}
        </span>

        {/* Title and timer */}
        <span className="agent-reasoning-title">{isActive ? "Reasoning" : "Thought for"}</span>
        <span className="agent-reasoning-timer">{formatTime(elapsedSeconds)}</span>
      </div>

      {/* Steps - visible when expanded */}
      {isExpanded && steps.length > 0 && (
        <ul className="agent-reasoning-steps">
          {steps.map((step, i) => (
            <li key={i} className="agent-reasoning-step">
              {step}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const LoadingSpinner: React.FC = () => (
  <span className="agent-reasoning-spinner">
    {/* 6-dot braille pattern spinner */}
    <span className="spinner-dots">⠿</span>
  </span>
);
```

### Phase 4: CSS Styling

**File:** `src/styles/tailwind.css` (append to existing)

```css
/* Agent Reasoning Block */
.agent-reasoning-block {
  margin: 8px 0;
  padding: 12px 16px;
  border-radius: var(--radius-m);
  background: var(--background-secondary);
  border: 1px solid var(--background-modifier-border);
  font-size: var(--font-ui-small);
}

.agent-reasoning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
}

.agent-reasoning-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
}

.agent-reasoning-icon .chevron {
  transition: transform 0.15s ease;
  font-size: 10px;
}

.agent-reasoning-icon .chevron.expanded {
  transform: rotate(90deg);
}

.agent-reasoning-title {
  font-weight: var(--font-medium);
}

.agent-reasoning-timer {
  color: var(--text-faint);
}

.agent-reasoning-steps {
  margin: 8px 0 0 24px;
  padding: 0;
  list-style: disc;
}

.agent-reasoning-step {
  margin: 4px 0;
  color: var(--text-normal);
  line-height: 1.4;
}

/* Spinner animation */
.agent-reasoning-spinner .spinner-dots {
  display: inline-block;
  animation: reasoning-pulse 1s ease-in-out infinite;
}

@keyframes reasoning-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}
```

### Phase 5: Message Rendering Integration

**File:** `src/components/chat-components/ChatSingleMessage.tsx`

**Changes:**

1. Add parsing for reasoning block marker:

```typescript
function parseAgentReasoningMarker(content: string): {
  hasReasoning: boolean;
  status: "reasoning" | "collapsed" | "complete";
  elapsedSeconds: number;
  steps: string[];
  contentAfter: string;
} | null {
  const match = content.match(/<!--AGENT_REASONING:(\w+):(\d+):(.+?)-->/);
  if (!match) return null;

  const [fullMatch, status, elapsed, stepsJson] = match;
  const steps = JSON.parse(stepsJson) as string[];

  return {
    hasReasoning: true,
    status: status as "reasoning" | "collapsed" | "complete",
    elapsedSeconds: parseInt(elapsed, 10),
    steps,
    contentAfter: content.replace(fullMatch, "").trim(),
  };
}
```

2. Update render logic:

```typescript
// In ChatSingleMessage render:
const reasoningData = parseAgentReasoningMarker(message.content);

return (
  <div className="chat-message">
    {/* Agent Reasoning Block (if present) */}
    {reasoningData?.hasReasoning && (
      <AgentReasoningBlock
        status={reasoningData.status}
        elapsedSeconds={reasoningData.elapsedSeconds}
        steps={reasoningData.steps}
        isStreaming={isStreaming}
      />
    )}

    {/* Message content (after reasoning marker) */}
    <div className="message-content">
      {/* Render remainingContent via markdown */}
    </div>
  </div>
);
```

### Phase 6: Remove Old Tool Call Banner

**Files to modify:**

1. `src/components/chat-components/ToolCallBanner.tsx` - Delete or deprecate
2. `src/components/chat-components/toolCallRootManager.tsx` - Simplify or remove
3. `src/LLMProviders/chainRunner/utils/toolCallParser.ts` - Keep for backward compat with saved messages
4. `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts` - Remove tool call marker handling

**Deprecation strategy:**

- Keep `parseToolCallMarkers()` for rendering old saved messages
- Remove `createToolCallMarker()` and `updateToolCallMarker()`
- Don't create new tool call markers in agent runner

### Phase 7: Disable Thinking Block in Agent Mode

**File:** `src/LLMProviders/chainRunner/utils/ThinkBlockStreamer.ts`

Add flag to skip thinking content extraction in agent mode:

```typescript
export class ThinkBlockStreamer {
  private suppressThinkingContent: boolean;

  constructor(
    updateFn: (message: string) => void,
    options?: { suppressThinkingContent?: boolean }
  ) {
    this.updateFn = updateFn;
    this.suppressThinkingContent = options?.suppressThinkingContent ?? false;
  }

  processChunk(chunk: any): void {
    if (this.suppressThinkingContent) {
      // Skip thinking content, only extract text
      // ... simplified logic ...
    } else {
      // ... existing thinking block logic ...
    }
  }
}
```

In AutonomousAgentChainRunner:

```typescript
const streamer = new ThinkBlockStreamer(updateCurrentAiMessage, {
  suppressThinkingContent: true, // Agent mode uses AgentReasoningBlock instead
});
```

---

## Performance Considerations

1. **Timer Updates**: Use 100ms interval for responsive feel without excessive re-renders
2. **Step Limit**: Keep only last 2 steps to prevent DOM bloat
3. **Marker Format**: Compact JSON for minimal message overhead
4. **React Roots**: Use same pattern as tool call banner for persistent roots

---

## Migration Path

1. **Phase 1**: Add new AgentReasoningBlock alongside existing tool call banner
2. **Phase 2**: Test with agent mode, ensure backward compat with old messages
3. **Phase 3**: Remove tool call banner creation code (keep parsing)
4. **Phase 4**: Clean up deprecated code after stable release

---

## Testing Checklist

- [ ] Timer updates smoothly (no flicker)
- [ ] Steps appear as tools execute
- [ ] Block collapses when final response starts
- [ ] Collapsed block shows correct elapsed time
- [ ] Click to expand works after response complete
- [ ] Old messages with tool call banners still render
- [ ] No thinking blocks appear in agent mode
- [ ] Performance: no lag with multiple iterations

---

## File Summary

| File                            | Action                                |
| ------------------------------- | ------------------------------------- |
| `AgentReasoningState.ts`        | **New** - State management            |
| `AgentReasoningBlock.tsx`       | **New** - React component             |
| `AutonomousAgentChainRunner.ts` | **Modify** - Add reasoning tracking   |
| `ChatSingleMessage.tsx`         | **Modify** - Render reasoning block   |
| `ThinkBlockStreamer.ts`         | **Modify** - Add suppress option      |
| `tailwind.css`                  | **Modify** - Add styles               |
| `ToolCallBanner.tsx`            | **Deprecate** - Keep for old messages |
| `toolCallParser.ts`             | **Keep** - Backward compat only       |
