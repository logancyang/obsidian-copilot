# Phase 5: Discuss Action - Detailed Development Plan

## Overview

Phase 5 implements a project-focused chat interface ("Discuss") that enables AI-powered conversations within the context of a Projects+ project. Users can discuss their project goals, ask questions about assigned notes, and get contextual guidance—all with auto-saved conversation history.

---

## Product Decisions Summary

| Decision                | Choice                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| **Input Style**         | Simplified editor; @notes limited to project notes only; @web supported; no @vault               |
| **Context Strategy**    | Semantic + lexical search within project notes per message; force-selected notes always included |
| **Topic Naming**        | AI auto-generates after first exchange; user can rename later                                    |
| **Deleted Notes**       | Gracefully skip with warning badge                                                               |
| **Resume Mode**         | Full history in both UI and LLM memory                                                           |
| **Sources Display**     | Collapsible "Sources" section at end of AI responses                                             |
| **Suggested Questions** | Generate 3-4 at conversation start                                                               |
| **Off-topic Handling**  | Gentle redirect to project topics                                                                |

---

## Architecture

### Component Hierarchy

```
ProjectDetail.tsx
    ↓ (click "Discuss")
DiscussView.tsx (main container)
    ├── DiscussHeader.tsx (project info + conversation title)
    ├── SuggestedQuestions.tsx (3-4 AI-generated prompts)
    ├── MessageList.tsx (reuse shared component)
    │   └── DiscussMessage.tsx (message + source attribution)
    └── DiscussInput.tsx (ChatEditorCore + @note picker)

State Management:
    DiscussChatState (React state manager)
        ↓
    DiscussMessageRepository (extends MessageRepository)
        ↓
    ConversationPersistence (file I/O)
```

### Data Flow

1. **Entry**: User clicks "Discuss" from `ProjectDetail.tsx`
2. **State Init**: `DiscussChatState` initializes with project context; loads conversation if resuming
3. **Send Message**: User message → context building → LLM → streaming response → auto-save
4. **Resume**: Load conversation file → parse messages → populate repo + memory

---

## Files to Create

### Core Infrastructure

| File                                                | Purpose                                                       |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `src/types/discuss.ts`                              | Discuss-specific types (DiscussMessage, ConversationMetadata) |
| `src/prompts/discuss-system.ts`                     | System prompt for project-focused discussion                  |
| `src/core/projects-plus/ConversationPersistence.ts` | Save/load conversation markdown files                         |
| `src/core/projects-plus/DiscussContextBuilder.ts`   | Build context from project notes via scoped search            |

### State Management

| File                            | Purpose                                       |
| ------------------------------- | --------------------------------------------- |
| `src/state/DiscussChatState.ts` | React state manager for Discuss conversations |
| `src/hooks/useDiscussChat.ts`   | React hook for Discuss state integration      |

### UI Components

| File                                                          | Purpose                           |
| ------------------------------------------------------------- | --------------------------------- |
| `src/components/projects-plus/discuss/DiscussView.tsx`        | Main container component          |
| `src/components/projects-plus/discuss/DiscussHeader.tsx`      | Project info + conversation title |
| `src/components/projects-plus/discuss/DiscussInput.tsx`       | ChatEditorCore + @note picker     |
| `src/components/projects-plus/discuss/DiscussMessage.tsx`     | Message rendering with sources    |
| `src/components/projects-plus/discuss/SourceAttribution.tsx`  | Collapsible sources section       |
| `src/components/projects-plus/discuss/SuggestedQuestions.tsx` | Initial question chips            |

### Files to Modify

| File                                             | Changes                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| `src/components/projects-plus/ProjectDetail.tsx` | Add "Discuss" button, conversation list section |
| `src/core/projects-plus/ProjectManager.ts`       | Add conversation management methods             |
| `src/types/projects-plus.ts`                     | May need minor extensions                       |

---

## Key Implementation Details

### 1. System Prompt (`src/prompts/discuss-system.ts`)

```typescript
export const DISCUSS_SYSTEM_PROMPT = `You are a focused project assistant helping the user work on their project.

## Project Context
Project: {projectTitle}
Description: {projectDescription}
Success Criteria: {successCriteria}

## Guidelines
1. Keep discussions focused on the project and its goals
2. Reference the user's notes when answering questions
3. If asked about unrelated topics, gently acknowledge and redirect to the project
4. When citing information from notes, clearly indicate the source
5. Be concise but thorough

## Source Citation
When referencing information from the user's notes, include a "Sources" section at the end:
**Sources:** [[note-name-1]], [[note-name-2]]
`;
```

### 2. Context Building Strategy

```typescript
// DiscussContextBuilder.ts

async buildContext(params: {
  projectId: string;
  userMessage: string;
  forcedNotes: TFile[];  // User explicitly @mentioned
}): Promise<DiscussContext> {

  // 1. Get project notes
  const project = this.projectManager.getProject(projectId);
  const projectNotePaths = project.notes.map(n => n.path);

  // 2. Semantic + lexical search WITHIN project notes only
  const relevantNotes = await this.searchWithinScope(
    userMessage,
    projectNotePaths,
    { maxResults: 5, minScore: 0.3 }
  );

  // 3. Merge with forced notes (always included)
  const contextNotes = this.mergeAndDedupe(relevantNotes, forcedNotes);

  // 4. Load note contents
  const noteContents = await this.loadNoteContents(contextNotes);

  return {
    notes: contextNotes,
    noteContents,
    systemPrompt: this.buildSystemPrompt(project)
  };
}
```

### 3. Conversation Persistence Format

**File Location**: `copilot/projects/{project-id}__slug/conversations/{conversation-id}.md`

```markdown
---
id: "conv-abc123"
projectId: "project-xyz"
title: "Understanding TypeScript Generics"
createdAt: 1704100800000
updatedAt: 1704104400000
messageCount: 8
---

# Understanding TypeScript Generics

## user (2024-01-01 10:00)

How do I use generics in TypeScript?

## assistant (2024-01-01 10:01)

Generics allow you to create reusable components...

**Sources:** [[typescript-basics]], [[advanced-patterns]]
```

### 4. Auto-Save Behavior

```typescript
// Save after each assistant response completes
async onAssistantResponseComplete(response: ChatMessage): Promise<void> {
  // Generate title from AI if first exchange
  if (this.messages.length === 2 && !this.conversationTitle) {
    this.conversationTitle = await this.generateTitle();
  }

  // Save to file
  await this.persistence.saveConversation({
    project: this.project,
    conversationId: this.conversationId,
    title: this.conversationTitle,
    messages: this.messages
  });

  // Update project's conversation refs
  await this.projectManager.updateConversationRef(
    this.project.id,
    this.conversationId,
    this.conversationTitle,
    this.messages.length
  );
}
```

### 5. Suggested Questions Generation

```typescript
async generateSuggestedQuestions(): Promise<string[]> {
  const project = this.projectManager.getProject(this.projectId);
  const notesSummary = await this.buildNotesSummary(project.notes.slice(0, 5));

  const prompt = `Based on this project and notes, generate 3-4 thoughtful questions:

Project: ${project.title}
Description: ${project.description}
Success Criteria: ${project.successCriteria.join(', ')}

Notes Summary:
${notesSummary}

Return ONLY a JSON array: ["Question 1?", "Question 2?", "Question 3?"]`;

  const response = await chatModel.invoke(prompt);
  return JSON.parse(response.content);
}
```

### 6. Source Attribution UI

```tsx
// SourceAttribution.tsx
export function SourceAttribution({ sources, onOpenNote }) {
  return (
    <details className="tw-mt-2 tw-rounded tw-border tw-border-solid tw-border-border tw-p-2">
      <summary className="tw-cursor-pointer tw-text-sm tw-text-muted">
        Sources ({sources.length})
      </summary>
      <div className="tw-mt-2 tw-flex tw-flex-wrap tw-gap-1">
        {sources.map((source) => (
          <button
            onClick={() => source.exists && onOpenNote(source.path)}
            disabled={!source.exists}
            className={cn(
              "tw-rounded tw-px-2 tw-py-0.5 tw-text-xs",
              source.exists
                ? "tw-bg-secondary tw-text-normal hover:tw-underline"
                : "tw-bg-modifier-error-rgb/20 tw-text-muted tw-line-through"
            )}
          >
            {source.title}
            {!source.exists && <AlertTriangle className="tw-ml-1 tw-size-3" />}
          </button>
        ))}
      </div>
    </details>
  );
}
```

### 7. Resume Flow

```typescript
async loadConversation(conversationId: string): Promise<void> {
  const result = await this.persistence.loadConversation(
    this.project,
    conversationId
  );

  if (!result) throw new Error('Conversation not found');

  // Validate notes still exist
  this.validateNoteSources(result.messages);

  // Load into state
  this.messages = result.messages;
  this.conversationId = conversationId;
  this.conversationTitle = result.metadata.title;

  // Rebuild LLM memory from history
  await this.rebuildMemoryFromMessages(result.messages);

  this.notifyListeners();
}
```

---

## Edge Cases & Error Handling

| Scenario                            | Handling                                 |
| ----------------------------------- | ---------------------------------------- |
| Project deleted during conversation | Show error, offer to close               |
| Note deleted after being referenced | Warning badge on source, skip in context |
| Network error during streaming      | Show error with retry button             |
| Empty project (no notes)            | Allow conversation with warning          |
| Conversation file corrupted         | Error message, offer new conversation    |
| Token limit exceeded                | Truncate oldest context notes            |

---

## Implementation Order

### Step 1: Types & Persistence (Foundation)

1. Create `src/types/discuss.ts` - conversation types
2. Create `src/prompts/discuss-system.ts` - system prompt
3. Create `src/core/projects-plus/ConversationPersistence.ts` - file I/O

### Step 2: Context Building

4. Create `src/core/projects-plus/DiscussContextBuilder.ts` - scoped search

### Step 3: State Management

5. Create `src/state/DiscussChatState.ts` - main state manager
6. Create `src/hooks/useDiscussChat.ts` - React hook

### Step 4: UI Components

7. Create `SourceAttribution.tsx`
8. Create `SuggestedQuestions.tsx`
9. Create `DiscussHeader.tsx`
10. Create `DiscussInput.tsx` - ChatEditorCore + @note
11. Create `DiscussMessage.tsx`
12. Create `DiscussView.tsx` - main container

### Step 5: Integration

13. Modify `ProjectDetail.tsx` - add Discuss button + conversation list
14. Modify `ProjectManager.ts` - conversation management methods

### Step 6: Testing

15. Unit tests for `ConversationPersistence`
16. Unit tests for `DiscussContextBuilder`
17. Integration tests for conversation flow

---

## Critical Files to Reference

- `src/core/MessageRepository.ts` - Pattern for message storage
- `src/LLMProviders/chainRunner/CopilotPlusChainRunner.ts` - Chain runner pattern, @command handling
- `src/core/projects-plus/ProjectPersistence.ts` - YAML frontmatter file format pattern
- `src/core/projects-plus/NoteAssignmentService.ts` - Scoped semantic search pattern
- `src/components/shared/ChatEditorCore.tsx` - Reusable editor
- `src/components/shared/MessageList.tsx` - Reusable message list

---

## Reuse Summary

| Component/Pattern        | Reuse Strategy                              |
| ------------------------ | ------------------------------------------- |
| `ChatEditorCore`         | Use directly for input                      |
| `MessageList`            | Use directly for message display            |
| `MessageRepository`      | Extend for source tracking                  |
| `CopilotPlusChainRunner` | Reference for streaming + @command patterns |
| `ProjectPersistence`     | Reference for YAML frontmatter format       |
| `NoteAssignmentService`  | Reference for scoped semantic search        |
| `ThinkBlockStreamer`     | Use directly for streaming                  |

---

## Open Questions Resolved

1. **Input style**: Simplified - @notes (project only) + @web; no @vault
2. **Context per message**: Semantic + lexical search within project notes
3. **Topic naming**: AI auto-generates after first exchange
4. **Deleted notes**: Warning badge, gracefully skip
5. **Resume**: Full history in UI + memory
6. **Sources**: Collapsible section at end
7. **Suggested questions**: 3-4 at start
8. **Off-topic**: Gentle redirect
