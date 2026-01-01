# Projects+ Phase 2: Goal Creation Flow - Detailed Technical Design

> Supplement to `projects-plus-technical-design.md` Phase 2 section

## Overview

This document provides the detailed technical specification for implementing the hybrid AI conversation + live form for goal creation in Projects+. The user describes their goal naturally to an AI assistant, which extracts structured data in real-time to populate form fields.

---

## Design Decisions

| Decision              | Choice                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| **Extraction Timing** | Inline JSON in each AI response                                                |
| **Extraction Format** | Hidden `<goal_extraction>{...}</goal_extraction>` XML block at end of response |
| **Manual Edits**      | AI acknowledges changes via context injection                                  |
| **Persistence**       | Memory only (show confirmation on navigation)                                  |
| **Model**             | User's default configured chat model                                           |
| **Ready State**       | Triggers when both name AND description are non-empty                          |
| **Edge Cases**        | Graceful fallbacks with retry hints                                            |

---

## Files to Create/Modify

### New Files

| File                                                | Purpose                                     |
| --------------------------------------------------- | ------------------------------------------- |
| `src/components/projects-plus/GoalCreation.tsx`     | Container orchestrating chat + form         |
| `src/components/projects-plus/GoalCreationChat.tsx` | Chat interface with extraction parsing      |
| `src/components/projects-plus/GoalCreationForm.tsx` | Live-updating form with manual edit support |
| `src/core/projects-plus/GoalCreationState.ts`       | State management for creation flow          |
| `src/prompts/goal-extraction.ts`                    | System prompt for goal extraction           |

### Files to Modify

| File                                             | Changes                                     |
| ------------------------------------------------ | ------------------------------------------- |
| `src/components/projects-plus/ProjectsPanel.tsx` | Add navigation to GoalCreation              |
| `src/types/projects-plus.ts`                     | Add GoalExtraction, GoalCreationState types |

---

## 1. Type Definitions

Add to `src/types/projects-plus.ts`:

```typescript
/**
 * Extracted goal data from AI conversation
 */
export interface GoalExtraction {
  /** Extracted goal name (2-8 words, action-oriented) */
  name: string;
  /** Extracted description (what the goal entails) */
  description: string;
  /** AI confidence in extraction (0.0-1.0) */
  confidence: number;
}

/**
 * State for goal creation flow
 */
export interface GoalCreationState {
  /** Current conversation messages */
  messages: GoalCreationMessage[];
  /** Latest extraction from AI */
  extraction: GoalExtraction | null;
  /** User's manual edits (override AI extraction) */
  manualEdits: Partial<GoalExtraction>;
  /** Whether goal is ready to create (name + description filled) */
  isReady: boolean;
  /** Whether currently streaming AI response */
  isStreaming: boolean;
  /** Any error message */
  error: string | null;
}

/**
 * Message in goal creation conversation
 */
export interface GoalCreationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}
```

---

## 2. System Prompt (`src/prompts/goal-extraction.ts`)

```typescript
export const GOAL_EXTRACTION_SYSTEM_PROMPT = `You are a thoughtful assistant helping users articulate and refine their goals. Your role is to guide a natural conversation that helps users clarify what they want to achieve.

## Your Objectives
1. Help users articulate their goals clearly and specifically
2. Ask clarifying questions to understand context and motivation
3. Extract a clear name (concise title) and description (detailed explanation)
4. Be conversational, warm, and encouraging - not robotic

## Conversation Guidelines
- Start with an open question about what they want to achieve
- Ask ONE follow-up question at a time (don't overwhelm)
- Help make vague goals more concrete and actionable
- If they mention multiple goals, help focus on one
- Keep responses concise (2-4 sentences typical, max 3 paragraphs)

## Probing for Deeper Understanding
Beyond surface-level goal articulation, help users examine:
1. **The Real Objective**: What outcome would make this feel truly successful?
2. **Worth Assessment**: Is the effort justified by the expected outcome?
3. **Success Criteria**: How will they know when they've achieved it?

When appropriate, ask questions like:
- "What would achieving this enable you to do?"
- "Why is now the right time to pursue this?"
- "What would success look like in concrete terms?"
- "What's the cost of NOT pursuing this goal?"
- "On a scale of 1-10, how important is this compared to other things you could work on?"

Don't ask all of these at once - weave them naturally into the conversation as the goal becomes clearer.

## Required Output Format
At the END of EVERY response, include this hidden extraction block:

<goal_extraction>{"name": "...", "description": "...", "confidence": 0.0}</goal_extraction>

Field rules:
- "name": Concise, action-oriented title (2-8 words). Use "" if not yet determined.
- "description": What the goal entails, why it matters to the user, and how they'll know they've succeeded. Include motivation, success criteria, and worthiness assessment when discussed. Use "" if not yet determined.
- "confidence": Number 0.0-1.0
  - 0.0-0.3: Still exploring, very unclear
  - 0.4-0.6: Have some idea but needs refinement
  - 0.7-0.9: Goal is fairly clear
  - 1.0: Goal is fully articulated

## Examples

### Example 1: Initial greeting
User: (starts conversation)
Assistant: What goal are you working toward? Tell me about what you'd like to accomplish in your own words.

<goal_extraction>{"name": "", "description": "", "confidence": 0.0}</goal_extraction>

### Example 2: Vague initial response
User: I want to get better at coding
Assistant: That's a great goal! What aspect of coding interests you most right now - learning a new language, building a specific project, or something else?

<goal_extraction>{"name": "Improve coding skills", "description": "Get better at programming", "confidence": 0.3}</goal_extraction>

### Example 3: More specific
User: I want to learn React so I can build a portfolio website
Assistant: Nice! Building a portfolio with React is a solid goal. Do you have experience with JavaScript already, or would you be learning that alongside React?

<goal_extraction>{"name": "Build React portfolio", "description": "Learn React to build a personal portfolio website showcasing projects", "confidence": 0.7}</goal_extraction>

### Example 4: Well-defined goal
User: I have JS experience. I want to have a live portfolio site with at least 3 project showcases within 2 months.
Assistant: Perfect - that's a clear, achievable goal! Having 3 project showcases on a live React portfolio in 2 months is specific and measurable. I've captured everything in the form above. Ready to find relevant notes from your vault?

<goal_extraction>{"name": "Build React portfolio website", "description": "Create a live portfolio website using React that showcases at least 3 projects, to be completed within 2 months. Building on existing JavaScript knowledge.", "confidence": 0.95}</goal_extraction>

### Example 5: Multiple goals mentioned
User: I want to learn Spanish, start a blog, and get better at cooking
Assistant: Those are all great goals! To make meaningful progress, let's focus on one at a time. Which of these feels most important to you right now - Spanish, blogging, or cooking?

<goal_extraction>{"name": "", "description": "User mentioned multiple goals: learning Spanish, starting a blog, improving cooking skills. Needs to narrow focus.", "confidence": 0.1}</goal_extraction>

### Example 6: Very vague input
User: I want to be better
Assistant: That's a great mindset! "Better" can mean many things - could you tell me a bit more? Is there a specific skill, area of your life, or project you're thinking about improving?

<goal_extraction>{"name": "", "description": "", "confidence": 0.0}</goal_extraction>

### Example 7: User already has clear goal
User: I need to finish my thesis on machine learning applications in healthcare. I have 3 chapters left and need to submit by March 15th.
Assistant: That's a very clear and time-bound goal! Finishing your ML in healthcare thesis with 3 chapters before March 15th gives you a concrete target to work toward. I've captured this in the form above. Would you like to find notes in your vault that might help with your remaining chapters?

<goal_extraction>{"name": "Complete ML healthcare thesis", "description": "Finish remaining 3 chapters of thesis on machine learning applications in healthcare. Deadline: March 15th.", "confidence": 0.95}</goal_extraction>

### Example 8: User provides info in pieces
User: I'm trying to get promoted
Assistant: Career growth is a valuable goal! What kind of role are you aiming for - a senior position in your current track, a management role, or something else?

<goal_extraction>{"name": "Get promoted", "description": "Seeking career advancement", "confidence": 0.3}</goal_extraction>

User: I want to become a senior engineer. I've been a mid-level for 2 years.
Assistant: Moving from mid-level to senior engineer after 2 years is a solid progression target. What do you think is the main gap between where you are now and that senior role? Technical depth, leadership, or something else?

<goal_extraction>{"name": "Become senior engineer", "description": "Progress from mid-level to senior software engineer after 2 years in current role", "confidence": 0.6}</goal_extraction>

### Example 9: Off-topic question
User: What's the weather like today?
Assistant: I don't have access to weather data, but I'd love to help you define your goal! What are you working toward right now?

<goal_extraction>{"name": "", "description": "", "confidence": 0.0}</goal_extraction>

### Example 10: User manually edited form
[System: The user has manually updated the name field to: "Master Python programming"]
User: Yes that's what I want
Assistant: Great, "Master Python programming" it is! To help you define what mastery means to you, what would success look like? Building specific projects, passing a certification, or becoming proficient in certain areas like data science or web development?

<goal_extraction>{"name": "Master Python programming", "description": "Achieve mastery in Python programming", "confidence": 0.5}</goal_extraction>

### Example 11: Probing for deeper motivation
User: I want to write a book
Assistant: Writing a book is a significant undertaking! Before we dive into the details, I'm curious - what's driving this goal for you? Is it to share expertise, creative expression, build credibility, or something else entirely?

<goal_extraction>{"name": "Write a book", "description": "User wants to write a book. Motivation not yet explored.", "confidence": 0.2}</goal_extraction>

User: I've been in the industry for 15 years and keep explaining the same concepts to junior developers. I figured a book would help more people.
Assistant: That's a meaningful motivation - scaling your expertise to help more people than you could one-on-one. What would success look like for you? Is it about the number of readers, the impact on their careers, or simply having your knowledge documented?

<goal_extraction>{"name": "Write technical book", "description": "Write a book to share 15 years of industry expertise with junior developers. Motivation: scaling knowledge impact beyond 1:1 mentoring.", "confidence": 0.6}</goal_extraction>

### Example 12: Success criteria conversation
User: I want to get healthier
Assistant: Health means different things to different people. What would "healthier" look like for you specifically? Is it about energy levels, weight, being able to do certain activities, or something else?

<goal_extraction>{"name": "Improve health", "description": "User seeking better health", "confidence": 0.2}</goal_extraction>

User: I want to be able to run a 5K without stopping
Assistant: That's a concrete target! A couple more questions: Why a 5K specifically - is there an event you're training for, or is it more of a personal benchmark? And what would achieving this mean for you beyond the run itself?

<goal_extraction>{"name": "Run a 5K continuously", "description": "Be able to run 5 kilometers without stopping", "confidence": 0.5}</goal_extraction>

User: I signed up for a charity 5K in 3 months. I want to prove to myself I can commit to something physical.
Assistant: That's powerful - the charity event gives you a concrete deadline, and proving self-commitment gives it meaning beyond the race. So success isn't just crossing the finish line, but demonstrating to yourself that you can follow through on a physical commitment. Does that capture it?

<goal_extraction>{"name": "Complete charity 5K run", "description": "Run a charity 5K race in 3 months without stopping. Success criteria: (1) finish the race, (2) prove ability to commit to a physical goal. Motivation: demonstrating self-discipline through a concrete physical challenge.", "confidence": 0.9}</goal_extraction>

### Example 13: Worthiness assessment - uncertain goal
User: I should probably learn to code
Assistant: I noticed you said "should probably" - that's interesting! Where's this coming from? Is coding something you're genuinely excited about, or more something you feel external pressure to do?

<goal_extraction>{"name": "", "description": "User expressed tentative interest in learning to code. Motivation unclear - may be external pressure vs genuine interest.", "confidence": 0.1}</goal_extraction>

User: Honestly, I keep hearing it's a valuable skill but I'm not sure I'd actually use it
Assistant: That's an honest assessment! Learning to code takes significant time - typically months to become useful. Given you're not sure you'd use it, let me ask: is there a specific problem you'd want to solve with code, or a career benefit you're hoping for? Sometimes it helps to work backwards from what you'd actually do with the skill.

<goal_extraction>{"name": "", "description": "User uncertain about learning to code. Expressed doubt about practical application. Currently exploring whether the goal is worth pursuing.", "confidence": 0.1}</goal_extraction>

User: Not really, I think I was just feeling FOMO
Assistant: That's a valuable realization! FOMO isn't usually a sustainable motivator for a multi-month learning commitment. It might be worth revisiting this goal when you have a concrete problem you'd want to solve with code. For now, is there something else you're working toward that feels more aligned with what you actually want?

<goal_extraction>{"name": "", "description": "User realized coding goal was driven by FOMO rather than genuine need. Goal deprioritized - user encouraged to explore more aligned goals.", "confidence": 0.0}</goal_extraction>

## Handling Uncertain or Low-Conviction Goals
If the user seems uncertain about their goal:
- Explore the source of uncertainty without judgment
- Help them articulate what would make it worthwhile
- It's okay to conclude that a goal isn't worth pursuing right now
- Include the user's assessment of worthiness in the description

## Off-Topic Handling
If the user asks something unrelated to goal definition, gently redirect:
"That's interesting! But let's stay focused on defining your goal. [relevant follow-up question]"

## Form Edit Acknowledgment
When notified that the user edited the form, acknowledge naturally:
"I see you've updated [field] to '[value]'. [Continue conversation or confirm if complete]"

CRITICAL: Always include the <goal_extraction> block at the end of EVERY response, even if data is empty.`;

/**
 * Build the initial greeting message from the AI
 */
export function getInitialGreeting(): string {
  return `What goal are you working toward? Tell me about what you'd like to accomplish in your own words.

<goal_extraction>{"name": "", "description": "", "confidence": 0.0}</goal_extraction>`;
}

/**
 * Build context injection message when user manually edits the form
 */
export function buildFormEditContext(field: "name" | "description", value: string): string {
  return `[System: The user has manually updated the ${field} field to: "${value}"]`;
}
```

---

## 3. State Management (`src/core/projects-plus/GoalCreationState.ts`)

```typescript
import { GoalCreationState, GoalCreationMessage, GoalExtraction } from "@/types/projects-plus";
import { v4 as uuidv4 } from "uuid";

/**
 * Creates initial state for goal creation flow
 */
export function createInitialState(): GoalCreationState {
  return {
    messages: [],
    extraction: null,
    manualEdits: {},
    isReady: false,
    isStreaming: false,
    error: null,
  };
}

/**
 * Parse extraction block from AI response
 * Returns null if extraction block not found or invalid
 */
export function parseGoalExtraction(response: string): GoalExtraction | null {
  const match = response.match(/<goal_extraction>([\s\S]*?)<\/goal_extraction>/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    return {
      name: typeof data.name === "string" ? data.name : "",
      description: typeof data.description === "string" ? data.description : "",
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Strip extraction block from response for display
 */
export function stripExtractionBlock(response: string): string {
  return response.replace(/<goal_extraction>[\s\S]*?<\/goal_extraction>/g, "").trim();
}

/**
 * Get the effective extraction (manual edits override AI extraction)
 */
export function getEffectiveExtraction(state: GoalCreationState): GoalExtraction {
  const base = state.extraction || { name: "", description: "", confidence: 0 };
  return {
    name: state.manualEdits.name ?? base.name,
    description: state.manualEdits.description ?? base.description,
    confidence: base.confidence,
  };
}

/**
 * Check if goal is ready to create (has name and description)
 */
export function checkIsReady(state: GoalCreationState): boolean {
  const effective = getEffectiveExtraction(state);
  return effective.name.trim().length > 0 && effective.description.trim().length > 0;
}

/**
 * Create a new message
 */
export function createMessage(role: "user" | "assistant", content: string): GoalCreationMessage {
  return {
    id: uuidv4(),
    role,
    content,
    timestamp: Date.now(),
  };
}
```

---

## 4. Component: GoalCreation.tsx (Container)

```typescript
interface GoalCreationProps {
  onCancel: () => void;
  onComplete: (extraction: GoalExtraction) => void; // → Navigate to Note Assignment
  goalManager: GoalManager;
}

// Key responsibilities:
// - Manage GoalCreationState
// - Orchestrate chat and form communication
// - Handle navigation confirmation on cancel
// - Pass extraction to Note Assignment phase when ready
```

**Component Structure:**

```
┌─────────────────────────────────────┐
│  ← Back          Creating Goal      │  ← Header with cancel confirmation
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │ GOAL PREVIEW              Live ││  ← GoalCreationForm
│  │ Name: [auto-populated]         ││
│  │ Description: [auto-populated]  ││
│  └─────────────────────────────────┘│
│                                     │
│  ───────── Chat ─────────────────── │
│                                     │
│  [Messages...]                      │  ← GoalCreationChat
│                                     │
│  ┌─────────────────────────────────┐│
│  │  🔍 Find Relevant Notes         ││  ← Shows when isReady
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  [Chat input...]                    │
└─────────────────────────────────────┘
```

---

## 5. Component: GoalCreationChat.tsx

```typescript
interface GoalCreationChatProps {
  messages: GoalCreationMessage[];
  isStreaming: boolean;
  currentStreamingContent: string;
  onSendMessage: (content: string) => void;
  onFormEditContext?: string; // Injected when user edits form
}

// Key responsibilities:
// - Display conversation messages (with extraction blocks stripped)
// - Handle user input
// - Show streaming indicator
// - Display suggested questions on empty state
```

**Suggested Questions (shown at start):**

- "I want to learn something new"
- "I'm working on a project"
- "I want to build a habit"

---

## 6. Component: GoalCreationForm.tsx

```typescript
interface GoalCreationFormProps {
  extraction: GoalExtraction;
  manualEdits: Partial<GoalExtraction>;
  onManualEdit: (field: "name" | "description", value: string) => void;
  isReady: boolean;
}

// Key responsibilities:
// - Display extracted/edited values
// - Show "Live" indicator when auto-updating
// - Highlight fields when they auto-populate (brief animation)
// - Allow manual editing with clear visual distinction
```

**Visual States:**

- **Auto-populated**: Normal text, "Live" badge visible
- **Manually edited**: Slightly different style, "Edited" badge
- **Empty**: Placeholder text, muted

---

## 7. Component State Management Architecture

### State Ownership & Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     GoalCreation.tsx (Container)                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  useGoalCreationChat(chainManager) hook                     ││
│  │  ├── state: GoalCreationState                               ││
│  │  ├── currentStreamingContent: string                        ││
│  │  ├── sendMessage(content, formEditContext?)                 ││
│  │  ├── abort()                                                ││
│  │  └── setManualEdit(field, value)                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  Local state:                                                    │
│  ├── pendingFormEditContext: string | null                      │
│  └── showDiscardConfirm: boolean                                │
└────────┬──────────────────────────────────────────┬─────────────┘
         │                                          │
         ▼                                          ▼
┌─────────────────────────┐              ┌─────────────────────────┐
│  GoalCreationForm.tsx   │              │  GoalCreationChat.tsx   │
│  ─────────────────────  │              │  ─────────────────────  │
│  Props:                 │              │  Props:                 │
│  • extraction           │              │  • messages             │
│  • manualEdits          │              │  • isStreaming          │
│  • onManualEdit ────────┼──────┐       │  • streamingContent     │
│  • isReady              │      │       │  • onSendMessage ───────┤
│                         │      │       │                         │
│  Local state:           │      │       │  Local state:           │
│  • highlightedField     │      │       │  • inputValue           │
│  • isEditing            │      │       │                         │
└─────────────────────────┘      │       └─────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │  Form edit triggers:    │
                    │  1. Update manualEdits  │
                    │  2. Set pendingContext  │
                    │  3. Next AI call        │
                    │     includes context    │
                    └─────────────────────────┘
```

### Hook: useGoalCreationChat

This custom hook encapsulates all chat-related state and logic:

```typescript
// Return type of useGoalCreationChat
interface UseGoalCreationChatReturn {
  // Core state
  state: GoalCreationState;
  currentStreamingContent: string;

  // Actions
  sendMessage: (content: string, formEditContext?: string) => Promise<void>;
  abort: () => void;
  setManualEdit: (field: "name" | "description", value: string) => void;
  reset: () => void;
}
```

### GoalCreation.tsx Implementation Sketch

```typescript
export default function GoalCreation({
  onCancel,
  onComplete,
  chainManager,
}: GoalCreationProps) {
  // Core chat state via custom hook
  const {
    state,
    currentStreamingContent,
    sendMessage,
    abort,
    setManualEdit,
  } = useGoalCreationChat(chainManager);

  // Local UI state
  const [pendingFormEdit, setPendingFormEdit] = useState<{
    field: "name" | "description";
    value: string;
  } | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Compute effective extraction (manual edits override AI)
  const effectiveExtraction = getEffectiveExtraction(state);

  // Handle form field edit
  const handleManualEdit = useCallback((field: "name" | "description", value: string) => {
    setManualEdit(field, value);
    // Queue context for next AI message
    setPendingFormEdit({ field, value });
  }, [setManualEdit]);

  // Handle sending chat message
  const handleSendMessage = useCallback(async (content: string) => {
    // Include form edit context if pending
    const formContext = pendingFormEdit
      ? buildFormEditContext(pendingFormEdit.field, pendingFormEdit.value)
      : undefined;

    await sendMessage(content, formContext);

    // Clear pending context after sending
    setPendingFormEdit(null);
  }, [sendMessage, pendingFormEdit]);

  // Handle navigation away
  const handleCancel = useCallback(() => {
    const hasData = state.messages.length > 0 ||
                    effectiveExtraction.name ||
                    effectiveExtraction.description;

    if (hasData) {
      setShowDiscardConfirm(true);
    } else {
      onCancel();
    }
  }, [state.messages.length, effectiveExtraction, onCancel]);

  // Handle completion
  const handleComplete = useCallback(() => {
    onComplete(effectiveExtraction);
  }, [effectiveExtraction, onComplete]);

  return (
    <div className="tw-flex tw-flex-col tw-h-full">
      {/* Header */}
      <div className="tw-flex tw-items-center tw-gap-2 tw-p-3 tw-border-b tw-border-border">
        <Button variant="ghost" size="sm" onClick={handleCancel}>
          <ChevronLeft /> Back
        </Button>
        <span className="tw-font-medium">Creating Goal</span>
      </div>

      {/* Form preview */}
      <GoalCreationForm
        extraction={effectiveExtraction}
        manualEdits={state.manualEdits}
        onManualEdit={handleManualEdit}
        isReady={state.isReady}
      />

      {/* Chat area */}
      <div className="tw-flex-1 tw-overflow-hidden">
        <GoalCreationChat
          messages={state.messages}
          isStreaming={state.isStreaming}
          currentStreamingContent={currentStreamingContent}
          onSendMessage={handleSendMessage}
        />
      </div>

      {/* Action button - shows when ready */}
      {state.isReady && !state.isStreaming && (
        <div className="tw-p-3 tw-border-t tw-border-border">
          <Button onClick={handleComplete} className="tw-w-full">
            <Search className="tw-mr-2" />
            Find Relevant Notes
          </Button>
        </div>
      )}

      {/* Discard confirmation dialog */}
      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
        title="Discard goal?"
        description="You'll lose your conversation progress."
        confirmText="Discard"
        onConfirm={onCancel}
      />
    </div>
  );
}
```

### Key State Management Principles

1. **Single Source of Truth**: All chat state lives in `useGoalCreationChat` hook
2. **Derived State**: `effectiveExtraction` is computed from `extraction` + `manualEdits`
3. **Unidirectional Flow**: Form edits → update state → trigger context injection
4. **Local UI State**: Form-only concerns (highlight animation, edit mode) stay local
5. **Cleanup on Unmount**: Hook handles abort controller cleanup automatically

---

## 8. Chat-Form Synchronization Protocol

### When AI Responds:

1. Stream response to UI via callback
2. When stream completes, parse `<goal_extraction>` block
3. If extraction found:
   - Update `state.extraction` with parsed data
   - Strip extraction block from displayed message
   - Trigger brief highlight animation on updated form fields
4. If extraction not found or invalid:
   - Log warning (graceful degradation)
   - Continue conversation normally
5. Update `isReady` based on effective extraction

### When User Manually Edits Form:

1. Update `state.manualEdits[field]`
2. Set `onFormEditContext` to trigger acknowledgment
3. On next AI call, prepend form edit context message
4. AI responds acknowledging the edit naturally
5. Clear `onFormEditContext` after injection

### Flow Diagram:

```
User types message
       ↓
 Add to messages[]
       ↓
 Call LLM with:
 - System prompt
 - Conversation history
 - [Optional: form edit context]
       ↓
 Stream response → update UI
       ↓
 Parse extraction → update form
       ↓
 Check isReady
```

---

## 9. LLM Integration & Streaming Implementation

### Building Messages for LLM:

```typescript
function buildLLMMessages(state: GoalCreationState, formEditContext?: string): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: GOAL_EXTRACTION_SYSTEM_PROMPT }];

  // Add conversation history
  for (const msg of state.messages) {
    messages.push({
      role: msg.role,
      content: msg.content, // Keep extraction blocks in history for context
    });
  }

  // Inject form edit context if present
  if (formEditContext) {
    messages.push({ role: "system", content: formEditContext });
  }

  return messages;
}
```

### Detailed Streaming Implementation:

The goal creation flow uses a simplified streaming approach compared to the main chat. It doesn't need tools or complex context processing.

```typescript
// In GoalCreation.tsx

import { useRef, useState, useCallback, useEffect } from "react";
import { ChatModelManager } from "@/LLMProviders/chatModelManager";

function useGoalCreationChat(chainManager: ChainManager) {
  const [state, setState] = useState<GoalCreationState>(createInitialState());
  const [currentStreamingContent, setCurrentStreamingContent] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Safe state setter to prevent updates after unmount
  const safeSetState = useCallback((updater: (prev: GoalCreationState) => GoalCreationState) => {
    if (isMountedRef.current) {
      setState(updater);
    }
  }, []);

  const sendMessage = useCallback(
    async (userContent: string, formEditContext?: string) => {
      // Add user message to state
      const userMessage = createMessage("user", userContent);
      safeSetState((prev) => ({
        ...prev,
        messages: [...prev.messages, userMessage],
        isStreaming: true,
        error: null,
      }));

      // Build messages for LLM
      const llmMessages = buildLLMMessages(
        { ...state, messages: [...state.messages, userMessage] },
        formEditContext
      );

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      try {
        // Get chat model from manager
        const chatModel = ChatModelManager.getInstance().getChatModel();

        // Stream the response
        let fullContent = "";
        const stream = await chatModel.stream(llmMessages, {
          signal: abortControllerRef.current.signal,
        });

        for await (const chunk of stream) {
          if (abortControllerRef.current?.signal.aborted) break;

          // Extract text content from chunk
          const chunkText = typeof chunk.content === "string" ? chunk.content : "";
          fullContent += chunkText;

          // Update streaming display (strip extraction block for display)
          const displayContent = stripExtractionBlock(fullContent);
          setCurrentStreamingContent(displayContent);
        }

        // Stream complete - parse extraction and add message
        const extraction = parseGoalExtraction(fullContent);
        const assistantMessage = createMessage("assistant", fullContent);

        safeSetState((prev) => {
          const newState = {
            ...prev,
            messages: [...prev.messages, assistantMessage],
            extraction: extraction || prev.extraction, // Keep previous if parse fails
            isStreaming: false,
          };
          return {
            ...newState,
            isReady: checkIsReady(newState),
          };
        });

        setCurrentStreamingContent("");
      } catch (error) {
        if (error.name === "AbortError") {
          // User cancelled - not an error
          safeSetState((prev) => ({ ...prev, isStreaming: false }));
        } else {
          logError("[GoalCreation] Error streaming response:", error);
          safeSetState((prev) => ({
            ...prev,
            isStreaming: false,
            error: "Failed to get response. Please try again.",
          }));
        }
        setCurrentStreamingContent("");
      }
    },
    [state, safeSetState]
  );

  const abort = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  return {
    state,
    currentStreamingContent,
    sendMessage,
    abort,
    setManualEdit: (field: "name" | "description", value: string) => {
      safeSetState((prev) => ({
        ...prev,
        manualEdits: { ...prev.manualEdits, [field]: value },
        isReady: checkIsReady({ ...prev, manualEdits: { ...prev.manualEdits, [field]: value } }),
      }));
    },
  };
}
```

### Key Streaming Patterns:

1. **Abort Controller**: Each request gets a new AbortController to support cancellation
2. **Safe State Updates**: Use `isMountedRef` to prevent updates after component unmount
3. **Progressive Display**: Strip extraction block during streaming so users see clean text
4. **Final Parse**: Parse extraction only after stream completes for reliability
5. **Graceful Degradation**: If extraction parse fails, keep previous extraction value

---

## 10. Navigation & Confirmation

### Cancel Behavior:

```typescript
const handleCancel = () => {
  if (state.messages.length > 0 || hasAnyData(state)) {
    // Show confirmation dialog
    showConfirmDialog({
      title: "Discard goal?",
      message: "You'll lose your conversation progress.",
      confirmText: "Discard",
      onConfirm: () => onCancel(),
    });
  } else {
    onCancel();
  }
};
```

### Complete (Find Notes) Behavior:

```typescript
const handleComplete = () => {
  const effective = getEffectiveExtraction(state);
  onComplete(effective); // Navigate to Note Assignment phase
};
```

---

## 11. Error Handling

| Scenario                 | Handling                                         |
| ------------------------ | ------------------------------------------------ |
| Extraction parse fails   | Continue normally, form stays at previous values |
| LLM request fails        | Show error toast, allow retry                    |
| User sends empty message | Ignore (button disabled)                         |
| AI goes off-topic        | Prompt handles via redirection instruction       |
| Network timeout          | Show "Request timed out" with retry option       |

---

## 12. Testing Checklist

### Unit Tests:

- [ ] `parseGoalExtraction()` handles valid/invalid JSON
- [ ] `stripExtractionBlock()` removes blocks correctly
- [ ] `checkIsReady()` validates both fields required
- [ ] `getEffectiveExtraction()` applies manual overrides

### Integration Tests:

- [ ] Chat sends message and receives streaming response
- [ ] Form updates when extraction parsed
- [ ] Manual edit injects context into next message
- [ ] Cancel shows confirmation when data exists
- [ ] "Find Notes" appears when ready

### Manual Verification:

1. Start goal creation → AI greets with question
2. Type vague goal → AI asks clarifying question, form partially fills
3. Refine goal → Form continues updating, "Goal Ready" appears
4. Edit form manually → AI acknowledges in next response
5. Click back → Confirmation dialog appears
6. Click "Find Notes" → Navigates to Note Assignment
