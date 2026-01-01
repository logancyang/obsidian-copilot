# Projects+ MVP Technical Design Document

## Overview

Projects+ is a goal-oriented workspace within Copilot for Obsidian. This document outlines the incremental implementation plan for the MVP (Discuss-only) scope.

**Key Design Decisions:**

- **Tool Access**: Notes only (no vault/web search tools in Discuss)
- **Auto-save**: Per message (save after each exchange)
- **File Format**: YAML frontmatter for goal.md
- **Architecture**: Refactor first to extract reusable components

---

## Phase 0: Infrastructure & Refactoring

### Objective

Extract reusable chat components to support Projects+ without code duplication.

### New Files

| File                                       | Purpose                                      |
| ------------------------------------------ | -------------------------------------------- |
| `src/components/shared/ChatEditorCore.tsx` | Lexical editor core extracted from ChatInput |
| `src/components/shared/MessageList.tsx`    | Generic message rendering component          |
| `src/core/BaseChatState.ts`                | Abstract interface for chat state management |

### Files to Modify

| File                                              | Changes                                   |
| ------------------------------------------------- | ----------------------------------------- |
| `src/components/chat-components/ChatInput.tsx`    | Refactor to use ChatEditorCore internally |
| `src/components/chat-components/ChatMessages.tsx` | Refactor to use MessageList internally    |

### Key Interfaces

```typescript
// ChatEditorCore - reusable editor component
interface ChatEditorCoreProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
  initialContent?: string;
  className?: string;
}

interface ChatEditorCoreRef {
  insertText: (text: string) => void;
  clear: () => void;
  focus: () => void;
  getText: () => string;
}

// BaseChatState - abstract chat state
interface BaseChatState {
  getMessages(): DisplayMessage[];
  addMessage(message: DisplayMessage): void;
  updateMessage(id: string, updates: Partial<DisplayMessage>): void;
  clearMessages(): void;
  subscribe(callback: () => void): () => void;
}
```

### Testing

- Unit tests for ChatEditorCore in isolation
- Integration tests verifying existing chat functionality unchanged

### Manual Verification in Obsidian

1. **Verify existing Copilot chat still works:**

   - Open Obsidian with the plugin loaded
   - Open Copilot panel (command: "Open Copilot")
   - Type a message and send it
   - Verify the chat input works as before (typing, sending, receiving responses)
   - Test context pills (@notes, @urls) still function correctly

2. **Verify no regressions:**
   - Check that streaming responses display correctly
   - Verify message editing works
   - Confirm message regeneration works
   - Test all existing chat features (copy, insert at cursor, etc.)

---

## Phase 1: Panel Shell & Goal CRUD

### Objective

Create ProjectsView panel and basic goal management with file system storage.

### New Files

| File                                             | Purpose                                  |
| ------------------------------------------------ | ---------------------------------------- |
| `src/components/projects-plus/ProjectsView.tsx`  | ItemView wrapper (like CopilotView)      |
| `src/components/projects-plus/ProjectsPanel.tsx` | Main container with navigation           |
| `src/components/projects-plus/GoalList.tsx`      | List of goals with search/filter         |
| `src/components/projects-plus/GoalCard.tsx`      | Individual goal card component           |
| `src/core/projects-plus/GoalManager.ts`          | CRUD operations for goals                |
| `src/core/projects-plus/GoalPersistence.ts`      | Read/write goal.md with YAML frontmatter |
| `src/types/projects-plus.ts`                     | Goal and related type definitions        |

### Files to Modify

| File                    | Changes                                                  |
| ----------------------- | -------------------------------------------------------- |
| `src/main.ts`           | Register view, add command, initialize GoalManager       |
| `src/constants.ts`      | Add `PROJECTS_PLUS_VIEWTYPE`, `DEFAULT_PROJECTS_FOLDER`  |
| `src/settings/model.ts` | Add `projectsPlusEnabled`, `projectsPlusFolder` settings |

### Key Types

```typescript
interface Goal {
  id: string;
  name: string;
  description: string;
  status: "active" | "completed" | "archived";
  notes: GoalNote[];
  conversations: ConversationRef[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  reflection?: string;
}

interface GoalNote {
  path: string;
  assignedAt: number;
  relevanceScore?: number;
  manuallyAdded: boolean;
}

interface ConversationRef {
  id: string;
  title: string;
  path: string;
  createdAt: number;
  messageCount: number;
}
```

### Folder Structure

```
copilot/projects/
└── [goal-name]/
    ├── goal.md              # Metadata + description
    └── conversations/
        └── [topic].md       # Saved discussions
```

### goal.md Format

```yaml
---
id: "uuid"
name: "Learn TypeScript"
status: "active"
createdAt: 1704067200000
updatedAt: 1704153600000
notes:
  - path: "Notes/typescript-basics.md"
    assignedAt: 1704067200000
    relevanceScore: 0.85
    manuallyAdded: false
conversations:
  - id: "conv-uuid"
    title: "Understanding Generics"
    path: "conversations/understanding-generics.md"
    createdAt: 1704100800000
    messageCount: 12
---
# Learn TypeScript

Master TypeScript for better code quality and developer experience.
```

### Testing

- Unit tests for GoalManager CRUD operations
- Unit tests for GoalPersistence serialization

### Manual Verification in Obsidian

1. **Verify Projects+ panel opens:**

   - Run command: "Open Projects+" (or use ribbon icon if added)
   - Verify the panel opens in the right sidebar
   - Check that the panel shows "Projects+" title and target icon

2. **Verify empty state:**

   - With no goals, verify the welcome/empty state is displayed
   - Check "Create your first goal" button is visible

3. **Verify goal creation (basic):**

   - Click "New Goal" or "Create your first goal"
   - Manually enter a goal name and description (if form is available at this phase)
   - Click create
   - Verify goal appears in the list

4. **Verify folder structure created:**

   - Open Obsidian's file explorer
   - Navigate to `copilot/projects/`
   - Verify a folder exists with the goal name (slugified)
   - Open `goal.md` and verify YAML frontmatter is correct
   - Check that the `conversations/` subfolder exists

5. **Verify goal CRUD operations:**

   - **Read**: Click a goal card, verify it navigates to detail (or shows info)
   - **Update**: Edit goal name/description, verify changes persist after reload
   - **Delete**: Delete a goal, verify folder is removed from vault

6. **Verify persistence across restart:**
   - Create a goal
   - Reload Obsidian (Cmd+R)
   - Open Projects+ panel
   - Verify the goal still appears with correct data

---

## Phase 2: Goal Creation Flow

### Objective

Implement hybrid AI conversation + live form for goal creation.

### New Files

| File                                                | Purpose                                   |
| --------------------------------------------------- | ----------------------------------------- |
| `src/components/projects-plus/GoalCreation.tsx`     | Container for hybrid creation UI          |
| `src/components/projects-plus/GoalCreationChat.tsx` | Chat interface for goal discovery         |
| `src/components/projects-plus/GoalCreationForm.tsx` | Live-updating form with extracted values  |
| `src/core/projects-plus/GoalExtractionChain.ts`     | LangChain prompt for extracting goal info |
| `src/prompts/goal-extraction.ts`                    | System prompt for extraction              |

### Key Interfaces

```typescript
interface GoalExtraction {
  name: string | null;
  description: string | null;
  confidence: number;
  extractedFrom: string;
}

interface GoalCreationState {
  messages: DisplayMessage[];
  extraction: GoalExtraction | null;
  isReady: boolean;
  isCreating: boolean;
}
```

### AI Extraction Prompt

```typescript
const GOAL_EXTRACTION_PROMPT = `You are helping a user define a goal.
Extract from the conversation:
1. Goal Name: A concise, actionable title (3-7 words)
2. Goal Description: What they want to achieve

Respond in JSON:
{
  "name": "string or null",
  "description": "string or null",
  "confidence": 0.0-1.0
}`;
```

### Testing

- Unit tests for extraction chain with mock LLM
- Test form synchronization with extraction results

### Manual Verification in Obsidian

1. **Verify hybrid creation flow starts:**

   - Click "New Goal" from Projects+ panel
   - Verify the hybrid UI appears with chat on left/bottom and form on right/top
   - Check the AI greeting message appears asking about your goal

2. **Verify AI extraction works:**

   - Type: "I want to learn React for building web applications"
   - Send the message
   - Verify AI responds with follow-up questions
   - Check that the form auto-populates with extracted name (e.g., "Learn React")
   - Verify description field updates with extracted description

3. **Verify form live-updates:**

   - Continue the conversation with more details
   - Watch the form update as AI extracts more specific information
   - Verify the "Goal Ready" indicator appears when name + description are filled

4. **Verify manual override:**

   - Click "Edit manually" on the form
   - Modify the auto-extracted name or description
   - Verify your manual changes persist

5. **Verify creation completion:**

   - Click "Find Relevant Notes" or "Create Goal" button
   - Verify navigation to note assignment screen (Phase 3) or goal detail

6. **Verify cancellation:**
   - Start a new goal creation
   - Click "Back" or cancel
   - Verify confirmation dialog appears (if implemented)
   - Verify no partial goal is created

---

## Phase 3: AI Note Assignment

### Objective

Semantic search to suggest relevant notes based on goal description.

### New Files

| File                                               | Purpose                             |
| -------------------------------------------------- | ----------------------------------- |
| `src/components/projects-plus/NoteSuggestions.tsx` | Display suggested notes with scores |
| `src/components/projects-plus/NoteCard.tsx`        | Individual note suggestion card     |
| `src/core/projects-plus/NoteAssignmentService.ts`  | Semantic search integration         |

### Key Interfaces

```typescript
interface NoteSuggestion {
  path: string;
  title: string;
  relevanceScore: number;
  snippet: string;
  tags: string[];
  mtime: number;
}

class NoteAssignmentService {
  suggestNotes(goalDescription: string, options?: NoteSearchOptions): Promise<NoteSuggestion[]>;
  searchNotes(query: string, options?: NoteSearchOptions): Promise<NoteSuggestion[]>;
}
```

### Integration Points

- Uses `MergedSemanticRetriever` from `src/search/v3/MergedSemanticRetriever.ts`
- Uses `TieredLexicalRetriever` from `src/search/v3/TieredLexicalRetriever.ts`

### Testing

- Unit tests with mocked retriever
- Test relevance scoring accuracy

### Manual Verification in Obsidian

**Prerequisites:** Have a vault with 20+ notes on various topics (e.g., programming, projects, daily notes).

1. **Verify note suggestion screen appears:**

   - Complete goal creation (from Phase 2) with a specific topic (e.g., "Learn TypeScript")
   - Click "Find Relevant Notes"
   - Verify loading state shows "Scanning vault..."
   - Verify suggestions screen appears with note list

2. **Verify relevance scoring:**

   - Check that suggested notes show relevance percentages (e.g., 95%, 78%)
   - Verify notes are sorted by relevance (highest first)
   - Check that notes actually related to the goal topic appear at the top
   - Verify unrelated notes (e.g., daily notes) have lower scores or don't appear

3. **Verify note selection:**

   - Click checkboxes to select/deselect notes
   - Verify "Select All" checkbox works
   - Check the selected count updates (e.g., "8 notes selected")
   - Verify deselecting a note removes it from count

4. **Verify note preview:**

   - Click a note row (not checkbox) to expand
   - Verify snippet/preview of note content is shown
   - Check that clicking the note title opens it in Obsidian

5. **Verify manual search:**

   - Click "+ Browse vault for more notes"
   - Verify vault browser/file picker opens
   - Select a note not in suggestions
   - Verify it's added to the selection

6. **Verify confirmation:**
   - With notes selected, click "Confirm & Create Goal"
   - Verify goal is created with selected notes assigned
   - Check `goal.md` file contains the note paths in YAML frontmatter

---

## Phase 4: Goal Detail & Notes

### Objective

Complete goal detail view with note management.

### New Files

| File                                                 | Purpose                      |
| ---------------------------------------------------- | ---------------------------- |
| `src/components/projects-plus/GoalDetail.tsx`        | Full goal detail view        |
| `src/components/projects-plus/GoalOverview.tsx`      | Name, description, stats     |
| `src/components/projects-plus/GoalNotes.tsx`         | Assigned notes list          |
| `src/components/projects-plus/NoteBrowser.tsx`       | Browse vault to select notes |
| `src/components/projects-plus/GoalConversations.tsx` | List saved discussions       |
| `src/components/projects-plus/GoalEditModal.tsx`     | Edit goal name/description   |

### Testing

- Component tests for GoalDetail
- Test note add/remove operations

### Manual Verification in Obsidian

**Prerequisites:** Have at least one goal created with 3+ notes assigned.

1. **Verify goal detail navigation:**

   - From goal list, click a goal card
   - Verify navigation to goal detail screen
   - Check "Back" button returns to goal list

2. **Verify goal overview section:**

   - Check goal name is displayed prominently
   - Verify description is shown (collapsible if long)
   - Check stats are displayed: note count, conversation count
   - Verify creation date is shown

3. **Verify notes section:**

   - Check all assigned notes are listed
   - Verify each note shows title and path
   - Click a note title -> verify it opens in Obsidian editor
   - Verify "Add Notes" button is visible

4. **Verify note management:**

   - Click "Add Notes" -> verify note picker/browser opens
   - Select a new note -> verify it's added to the goal
   - Click remove (X) on a note -> verify confirmation
   - Confirm removal -> verify note is removed from list
   - Check `goal.md` is updated with changes

5. **Verify "Suggest More Notes":**

   - Click "Suggest Notes" or similar button
   - Verify AI suggestions appear (reuses Phase 3 component)
   - Add a suggested note -> verify it appears in assigned list

6. **Verify conversations section:**

   - Check conversations section is visible (may be empty)
   - Verify "Discuss" action button is present
   - (Conversations list will be populated in Phase 5)

7. **Verify goal editing:**

   - Click "Edit" or "More -> Edit"
   - Verify edit modal opens with current values
   - Change name and description
   - Save -> verify changes reflect immediately
   - Check `goal.md` is updated

8. **Verify persistence:**
   - Make changes (add/remove notes, edit description)
   - Reload Obsidian
   - Open goal detail
   - Verify all changes persisted

---

## Phase 5: Discuss Action

### Objective

Chat with goal context injection, source attribution, and auto-save.

### New Files

| File                                                 | Purpose                                   |
| ---------------------------------------------------- | ----------------------------------------- |
| `src/components/projects-plus/DiscussView.tsx`       | Full chat interface                       |
| `src/components/projects-plus/DiscussHeader.tsx`     | Goal name + context summary               |
| `src/components/projects-plus/SourceAttribution.tsx` | Display source notes                      |
| `src/core/projects-plus/DiscussChatState.ts`         | Chat state for Discuss                    |
| `src/core/projects-plus/DiscussContextBuilder.ts`    | Build context from goal + notes           |
| `src/core/projects-plus/ConversationPersistence.ts`  | Auto-save conversations                   |
| `src/prompts/discuss-system.ts`                      | System prompt for goal-focused discussion |

### Key Interfaces

```typescript
interface DiscussChatState extends BaseChatState {
  goalId: string;
  conversationId: string;
  topic: string | null;
  sources: Map<string, SourceReference>;
}

interface SourceReference {
  path: string;
  title: string;
  usedAt: number;
  relevantSnippet?: string;
}

interface DiscussContext {
  systemPrompt: string;
  noteContents: Array<{ path: string; title: string; content: string }>;
  totalTokenEstimate: number;
}
```

### Conversation File Format

```markdown
---
id: "conv-uuid"
goalId: "goal-uuid"
title: "Understanding Generics"
createdAt: 1704100800000
updatedAt: 1704104400000
messageCount: 12
---

# Understanding Generics

## Messages

### User (2024-01-01 10:00)

How do I use generics in TypeScript?

### Assistant (2024-01-01 10:01)

Generics allow you to create reusable components...

**Sources:** [[typescript-basics]], [[advanced-patterns]]
```

### Auto-Save Behavior

- Save after each message exchange (per user decision)
- AI generates topic name after first meaningful exchange
- Conversations stored at `copilot/projects/[goal]/conversations/[topic].md`

### Testing

- Unit tests for DiscussContextBuilder
- Unit tests for ConversationPersistence
- Test source extraction from responses

### Manual Verification in Obsidian

**Prerequisites:** Have a goal with 5+ notes assigned on a specific topic (e.g., TypeScript notes for "Learn TypeScript" goal).

1. **Verify Discuss action starts:**

   - From goal detail, click "Discuss" or "Start ->"
   - Verify chat interface opens
   - Check header shows goal name
   - Verify AI greeting message appears with context summary (e.g., "I can help you explore your 5 notes about TypeScript")

2. **Verify suggested questions:**

   - Check that AI suggests relevant questions based on goal + notes
   - Click a suggested question
   - Verify it's inserted into input and can be sent

3. **Verify context-aware responses:**

   - Ask: "What patterns should I use based on my notes?"
   - Verify AI response references content from assigned notes
   - Check response is relevant to the goal topic

4. **Verify source attribution:**

   - In AI responses, check for "Sources" section
   - Verify source notes are listed
   - Click a source link -> verify it opens the note in Obsidian

5. **Verify streaming:**

   - Send a question
   - Verify response streams in real-time (not all at once)
   - Check loading indicator during response

6. **Verify auto-save (per message):**

   - After first exchange, check `copilot/projects/[goal]/conversations/` folder
   - Verify a new `.md` file is created
   - Open the file -> verify it contains the conversation
   - Send another message -> verify file is updated

7. **Verify AI-generated topic:**

   - Check conversation file name is auto-generated (e.g., "understanding-generics.md")
   - Verify topic appears in Discuss header after first exchange
   - Check conversation list in goal detail shows the topic

8. **Verify off-topic handling:**

   - Ask: "What's the best pizza in town?"
   - Verify AI gently redirects to goal-related topics
   - Check AI suggests relevant questions instead

9. **Verify conversation resume:**

   - Navigate back to goal detail
   - Check conversations list shows the saved conversation
   - Click the conversation -> verify it resumes with full history
   - Verify "Resumed" indicator or similar
   - Send a follow-up message -> verify it continues naturally

10. **Verify multiple conversations:**

    - Start a new conversation (not resume)
    - Verify it creates a separate file
    - Check goal detail shows both conversations

11. **Verify conversation deletion:**
    - From goal detail, delete a conversation
    - Verify confirmation dialog
    - Confirm -> verify conversation removed from list
    - Check file is deleted from `conversations/` folder

---

## Phase 6: Goal Completion & Settings

### Objective

Goal completion flow with reflection, and Projects+ settings tab.

### New Files

| File                                                  | Purpose                       |
| ----------------------------------------------------- | ----------------------------- |
| `src/components/projects-plus/GoalCompletion.tsx`     | Completion confirmation modal |
| `src/components/projects-plus/ArchivedGoals.tsx`      | List completed/archived goals |
| `src/components/projects-plus/GoalStatusBadge.tsx`    | Visual status indicator       |
| `src/settings/v2/components/ProjectsPlusSettings.tsx` | Settings tab                  |

### Files to Modify

| File                                 | Changes                |
| ------------------------------------ | ---------------------- |
| `src/settings/v2/SettingsMainV2.tsx` | Add "Projects+" tab    |
| `src/settings/model.ts`              | Add Projects+ settings |

### Settings

```typescript
interface ProjectsPlusSettings {
  enabled: boolean;
  folder: string; // Default: "copilot/projects"
  autoSaveEnabled: boolean; // Default: true
  defaultDiscussModel: string; // Model for Discuss
  showCompletedInList: boolean; // Show completed in main list
  noteSuggestionCount: number; // Default: 10
  excludedFolders: string[]; // Folders to exclude from suggestions
}
```

### Testing

- Test completion flow end-to-end
- Test goal status transitions
- Test settings persistence

### Manual Verification in Obsidian

**Prerequisites:** Have at least one active goal with notes and conversations.

1. **Verify completion flow initiation:**

   - From goal detail, click "Complete" or "Complete"
   - Verify completion confirmation modal appears
   - Check modal shows goal name and journey summary (notes engaged, conversations, days active)

2. **Verify optional reflection:**

   - Check reflection text area is present and optional
   - Enter a reflection: "Learned a lot about TypeScript patterns"
   - Verify text is accepted

3. **Verify completion confirmation:**

   - Click "Mark as Complete"
   - Verify goal status changes to "completed"
   - Check goal card shows checkmark and "Completed" badge
   - Verify goal moves to "Completed" section in goal list

4. **Verify archived goal view:**

   - Click the completed goal
   - Verify read-only archived view appears
   - Check "COMPLETED" banner with completion date
   - Verify reflection is displayed
   - Check stats are shown (notes used, conversations, duration)
   - Verify conversations are listed but read-only
   - Check notes list is present but can't be modified

5. **Verify read-only state:**

   - In archived view, verify no "Edit" or "Add Notes" buttons
   - Check "Discuss" action is disabled or hidden
   - Verify no modification actions are available

6. **Verify completed goals filtering:**

   - In goal list, check "Show/Hide Completed" toggle
   - Toggle off -> verify completed goals are hidden
   - Toggle on -> verify completed goals appear in separate section

7. **Verify `goal.md` updated:**

   - Open the completed goal's `goal.md` file
   - Check `status: "completed"` in frontmatter
   - Verify `completedAt` timestamp is set
   - Check `reflection` field contains your text

8. **Verify Settings tab exists:**

   - Open Copilot settings (gear icon)
   - Check for "Projects+" tab
   - Verify tab is clickable and shows settings

9. **Verify Settings options:**

   - **Projects folder path**: Change from default, verify new goals use new path
   - **Auto-save conversations**: Toggle off, verify conversations don't auto-save
   - **Note suggestion count**: Change to 5, verify only 5 notes suggested
   - **Excluded folders**: Add "templates/", verify notes from that folder aren't suggested

10. **Verify settings persistence:**

    - Change settings
    - Reload Obsidian
    - Open Projects+ settings
    - Verify settings persisted

11. **Verify goal restore (optional):**
    - If implemented: Click "Restore" on a completed goal
    - Verify goal status returns to "active"
    - Check goal moves back to active section

---

## Component Hierarchy

```
ProjectsView (ItemView)
└── ProjectsPanel
    ├── GoalList
    │   └── GoalCard[]
    ├── GoalCreation
    │   ├── GoalCreationChat
    │   ├── GoalCreationForm
    │   └── NoteSuggestions
    ├── GoalDetail
    │   ├── GoalOverview
    │   ├── GoalNotes
    │   │   ├── NoteCard[]
    │   │   ├── NoteSuggestions
    │   │   └── NoteBrowser
    │   └── GoalConversations
    └── DiscussView
        ├── DiscussHeader
        ├── MessageList (shared)
        ├── SourceAttribution
        └── ChatEditorCore (shared)
```

---

## File Structure (All New Files)

```
src/
├── components/
│   ├── shared/
│   │   ├── ChatEditorCore.tsx          # Phase 0
│   │   └── MessageList.tsx             # Phase 0
│   └── projects-plus/
│       ├── ProjectsView.tsx            # Phase 1
│       ├── ProjectsPanel.tsx           # Phase 1
│       ├── GoalList.tsx                # Phase 1
│       ├── GoalCard.tsx                # Phase 1
│       ├── GoalCreation.tsx            # Phase 2
│       ├── GoalCreationChat.tsx        # Phase 2
│       ├── GoalCreationForm.tsx        # Phase 2
│       ├── NoteSuggestions.tsx         # Phase 3
│       ├── NoteCard.tsx                # Phase 3
│       ├── GoalDetail.tsx              # Phase 4
│       ├── GoalOverview.tsx            # Phase 4
│       ├── GoalNotes.tsx               # Phase 4
│       ├── NoteBrowser.tsx             # Phase 4
│       ├── GoalConversations.tsx       # Phase 4
│       ├── GoalEditModal.tsx           # Phase 4
│       ├── DiscussView.tsx             # Phase 5
│       ├── DiscussHeader.tsx           # Phase 5
│       ├── SourceAttribution.tsx       # Phase 5
│       ├── GoalCompletion.tsx          # Phase 6
│       ├── ArchivedGoals.tsx           # Phase 6
│       └── GoalStatusBadge.tsx         # Phase 6
├── core/
│   ├── BaseChatState.ts                # Phase 0
│   └── projects-plus/
│       ├── GoalManager.ts              # Phase 1
│       ├── GoalPersistence.ts          # Phase 1
│       ├── GoalExtractionChain.ts      # Phase 2
│       ├── NoteAssignmentService.ts    # Phase 3
│       ├── DiscussChatState.ts         # Phase 5
│       ├── DiscussContextBuilder.ts    # Phase 5
│       └── ConversationPersistence.ts  # Phase 5
├── types/
│   └── projects-plus.ts                # Phase 1
├── prompts/
│   ├── goal-extraction.ts              # Phase 2
│   └── discuss-system.ts               # Phase 5
└── settings/v2/components/
    └── ProjectsPlusSettings.tsx        # Phase 6
```

---

## Critical Reference Files

| File                                           | Reason                            |
| ---------------------------------------------- | --------------------------------- |
| `src/components/CopilotView.tsx`               | Pattern for ItemView + React root |
| `src/components/chat-components/ChatInput.tsx` | Editor to refactor                |
| `src/core/MessageRepository.ts`                | Message storage pattern           |
| `src/search/v3/MergedSemanticRetriever.ts`     | Semantic search integration       |
| `src/settings/v2/SettingsMainV2.tsx`           | Settings tab structure            |

---

## Implementation Order

Each phase is independently deployable:

1. **Phase 0** - Foundation (enables all subsequent phases)
2. **Phase 1** - Basic panel + goal CRUD (usable standalone)
3. **Phase 2** - Smart goal creation (enhances creation UX)
4. **Phase 3** - AI note suggestions (enhances note assignment)
5. **Phase 4** - Full goal detail UI (complete goal management)
6. **Phase 5** - Discuss action (core value proposition)
7. **Phase 6** - Completion + settings (polish)

**Recommended MVP cutoff**: After Phase 5 (full Discuss functionality)
