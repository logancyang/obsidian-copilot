---
created: 2026-01-01
updated: 2026-01-01
---

# Projects+: Product Requirements Document

## Problem Statement

### The Knowledge Hoarder's Paradox

Modern knowledge workers are drowning in saved content. They bookmark articles, clip web pages, take notes, and build elaborate personal knowledge systems—yet rarely use what they collect. Research calls this the **"collector's fallacy"**: the false belief that saving information equals learning it.

The symptoms are universal:

- **Cognitive overload**: Hundreds of unread articles create low-grade anxiety
- **Guilt loops**: Every saved item becomes a silent reproach, a promise unkept
- **Illusion of progress**: Clicking "save" feels productive, but nothing is actually understood
- **Organizing as procrastination**: Elaborate tagging and filing systems become ends in themselves

The root cause is simple: **knowledge without purpose is just organized hoarding**.

### Why Existing Solutions Fail

Traditional approaches attack the wrong problem. Note-taking methodologies (PARA, Zettelkasten, Building a Second Brain) promise organization but often become "productivity procrastination"—sophisticated systems that feel like progress while producing nothing.

The fundamental issue remains: **people collect information with no clear goal for using it**. Better organization of purposeless content is still purposeless.

### The Insight

Educational research consistently shows that **goal-oriented learning** dramatically outperforms passive accumulation:

- **Just-in-time vs just-in-case**: Learning what you need _now_ for a specific project creates real-world value. Learning "just in case" creates digital clutter.
- **Context improves retention**: Knowledge tied to active projects is processed more deeply and remembered longer.
- **Meaning drives motivation**: When learning serves a genuine objective, it naturally feels meaningful rather than obligatory.

The opportunity: **flip the model**. Instead of accumulating knowledge and hoping it becomes useful, start with goals and let them pull in relevant knowledge.

---

## Product Vision

### What is Projects+?

**Projects+** is a goal-oriented workspace within Copilot for Obsidian that transforms passive note collections into action systems.

Knowledge sits dormant in your vault until you declare a goal. Then Projects+ activates that knowledge—pulling in relevant notes, helping you engage with purpose, and driving progress through focused conversations.

### Core Philosophy

```
"Collect freely. Engage with purpose."
```

1. **Goals are the lens**: Knowledge only becomes useful when viewed through the lens of what you're trying to achieve
2. **AI does the heavy lifting**: Organizing notes to goals is trivial because AI handles the matching
3. **No guilt, no judgment**: Unread notes are fine—they're raw material waiting for a goal to give them purpose
4. **Action over accumulation**: Every interaction moves you toward completing something real

### How It Works (High Level)

1. **Create a goal**: "Build my portfolio website" or "Prepare for system design interviews"
2. **AI matches notes**: Projects+ scans your vault and suggests relevant notes using semantic search
3. **Engage with purpose**: Goal-oriented discussions, all contextualized to your objective
4. **Complete and archive**: Goal becomes a read-only artifact capturing your journey

---

## Relationship to Current Project Mode

Projects+ represents the evolution of Copilot's existing project mode:

| Aspect             | Current Project Mode | Projects+                     |
| ------------------ | -------------------- | ----------------------------- |
| **Purpose**        | Context container    | Goal achievement system       |
| **Orientation**    | Content-centric      | Outcome-centric               |
| **Note selection** | Manual patterns      | AI-suggested + manual         |
| **Conversations**  | Single context chat  | Auto-saved, resumable threads |
| **Progress**       | None                 | Goal completion tracking      |
| **Storage**        | Config-based         | Self-contained folders        |

**Migration Strategy**: Gradual evolution

1. Projects+ launches as a separate panel alongside existing project mode
2. Users can continue using current project mode for simple context switching
3. New features developed exclusively for Projects+
4. Eventually sunset current project mode after user adoption

---

## Competitive Differentiation

### vs. NotebookLM (Google)

| Aspect          | NotebookLM                      | Projects+                       |
| --------------- | ------------------------------- | ------------------------------- |
| **Input**       | Upload documents to a project   | Your existing Obsidian vault    |
| **Orientation** | Source-centric (chat with docs) | Goal-centric (achieve outcomes) |
| **Persistence** | Isolated projects               | Continuous knowledge base       |
| **Philosophy**  | "Understand this content"       | "Accomplish this goal"          |

NotebookLM is excellent for understanding a specific set of documents. Projects+ is for turning your _entire_ accumulated knowledge into action across multiple ongoing objectives.

### vs. ChatGPT Projects

| Aspect                  | ChatGPT Projects              | Projects+                          |
| ----------------------- | ----------------------------- | ---------------------------------- |
| **Context**             | Upload files per conversation | Native access to Obsidian vault    |
| **Knowledge ownership** | Lives in OpenAI's cloud       | Lives in your local files          |
| **Workflow**            | General-purpose AI assistant  | Purpose-built for goal achievement |
| **Note evolution**      | Static uploads                | Dynamic vault that grows over time |

### Projects+ Unique Position

No existing tool combines:

- Native Obsidian integration (your existing vault)
- Goal-oriented framing (not topic-based)
- AI-powered note matching (zero manual curation)
- Conversation auto-save and resumption
- Self-contained, portable goal folders

---

## How Projects+ Transforms Knowledge into Action

### The Shift: From Collection to Completion

**Before Projects+**:

```
Notes → (accumulate) → More Notes → (organize) → Elaborate System → (never use)
```

**With Projects+**:

```
Goal declared → (AI matches) → Relevant Notes → (engage) → Goal Complete
```

### The Goal as a Container

A goal in Projects+ is more than a label—it's a **living knowledge workspace**:

- **Notes**: The subset of your vault relevant to this objective (linked, not copied)
- **Conversations**: Auto-saved discussion threads with AI-generated topic names
- **Metadata**: Goal description, creation date, completion status

When you complete a goal, it becomes a **read-only archive**—a record of what you learned and accomplished that you can revisit anytime.

### Goal Folder Structure

Each goal maps to a folder in your vault, creating a self-contained knowledge workspace:

```
copilot/projects/                          # Configurable root path
└── [goal-name]/
    ├── goal.md                            # Goal metadata and reflection
    └── conversations/
        └── [auto-generated-topic].md      # Auto-saved from Discuss action
```

This structure enables:

- **Knowledge accumulation**: Everything related to a goal lives in one place
- **Automatic organization**: No manual filing—AI handles topic naming and placement
- **Portability**: Goals are just folders; they can be moved, shared, or archived

---

## User Experience (High Level)

### First-Time Experience

1. User opens Projects+ panel for the first time
2. Projects+ explains the goal-oriented philosophy in 2 sentences
3. User clicks "Create your first goal"
4. **Hybrid Creation Flow**:
   - Chat guides the conversation: "What are you trying to accomplish?"
   - Live form updates as user responds (name, description, deadline)
   - User can edit form directly at any time
5. AI scans vault, proposes relevant notes using semantic search
6. User confirms note selection
7. Goal is active, Discuss action available

### Regular Usage

**Home Screen**: Lists active goals with key stats (note count, recent activity). One tap to enter any goal.

**Goal Detail Screen**: Shows assigned notes, available actions (Discuss), and history of past conversations. User can add/remove notes, start/resume discussions, or mark complete.

**Discuss Flow**: Opens a chat interface focused on the goal. AI answers using relevant notes plus its own knowledge. Conversations auto-save with AI-generated topic names. Users can resume previous conversations.

### Goal Lifecycle

```
Create → Active → Complete → Archived
```

- **Active goals**: Where work happens. Actions available.
- **Completed goals**: Read-only archives preserving full history.
- **Notes**: Never "used up"—same notes can serve multiple goals.

---

## MVP Scope

### MVP: Discuss-Only

All components needed to validate the goal-oriented approach:

1. **Projects+ Panel**

   - Separate Obsidian side panel (new ItemView)
   - Independent from main Copilot chat panel
   - Own tab in Copilot settings

2. **Goal Folder Structure**

   - Goals stored as folders at `copilot/projects/[goal-name]/`
   - Path configurable in settings
   - Goal metadata in `goal.md`
   - Conversations subfolder

3. **Goal + Notes UI**

   - Goal CRUD (create, read, update, delete)
   - Goal list and detail views
   - Manual note assignment
   - Goal completion/archival

4. **Hybrid Goal Creation**

   - Conversational flow + live form
   - AI extracts goal name, description from conversation
   - Optional deadline field
   - User can edit form directly

5. **AI-Powered Note Assignment**

   - Goal description analysis
   - Semantic search for relevant notes (leverage existing VectorStore)
   - Note relevance scoring
   - "AI suggests, user confirms" flow

6. **Discuss Action**
   - Chat interface using existing Copilot chat components
   - AI uses assigned notes + its own knowledge to answer
   - Source attribution showing which notes informed answers
   - Off-topic question handling (gentle redirect to goal)
   - **Auto-save conversations** with AI-generated topic names
   - **Resume previous conversations** from goal detail

### Post-MVP Roadmap

**Phase 2: Research & Draft**

- Research Action: Web search + AI synthesis → generated research notes
- Draft Action: Conversational document creation → generated drafts

**Phase 3: Learning Features**

- Q&A Action: Goal-contextualized question generation and testing
- Teach Me mode: Simplified explanations
- Challenge mode: Devil's advocate discussions

**Phase 4: Progress & Intelligence**

- Milestone-based progress tracking
- AI-suggested milestones during goal creation
- Deadline notifications
- Goal suggestions from vault clusters
- Cross-goal knowledge connections

---

## Technical Integration with Copilot

### Reusable Components

| Component               | Location                          | Usage in Projects+      |
| ----------------------- | --------------------------------- | ----------------------- |
| ChatMessages            | `src/components/chat-components/` | Discuss action UI       |
| ChatInput               | `src/components/chat-components/` | Discuss action input    |
| ChatSingleMessage       | `src/components/chat-components/` | Message rendering       |
| Card, Badge, Button     | `src/components/ui/`              | Goal cards, status      |
| Dialog                  | `src/components/ui/`              | Goal creation modal     |
| VectorStoreManager      | `src/search/`                     | Note relevance matching |
| MergedSemanticRetriever | `src/search/v3/`                  | Semantic search         |
| LLM Providers           | `src/LLMProviders/`               | AI responses            |

### New Components Needed

| Component           | Purpose                                  |
| ------------------- | ---------------------------------------- |
| ProjectsView        | New Obsidian ItemView for separate panel |
| GoalCard            | Goal display with metadata               |
| GoalList            | Home screen goal listing                 |
| GoalDetail          | Goal detail with notes and actions       |
| GoalCreationFlow    | Hybrid chat + form                       |
| NoteAssignment      | AI suggestions + manual selection        |
| ConversationList    | Resumable conversation threads           |
| ProjectsSettingsTab | Settings UI for Projects+                |

### Chain Runner Strategy

For MVP Discuss action:

- Use `CopilotPlusChainRunner` or `AutonomousAgentChainRunner`
- Goal context injected as system prompt (similar to current project mode)
- Assigned notes provided as context
- Tool access: `localSearch` for finding additional relevant notes

---

## Settings

Projects+ adds a new tab to Copilot settings:

**Projects+ Settings**

- **Projects folder path**: Default `copilot/projects/`, configurable
- **Auto-save conversations**: Toggle (default: on)
- **Note suggestion count**: Number of notes to suggest (default: 10)
- **Excluded folders**: Folders to exclude from note suggestions

---

## Marketing Positioning

### Tagline Options

- **"Your notes, activated."**
- **"From collection to completion."**
- **"Goal-driven knowledge."**

### Target Audience

**Primary**: Copilot users who:

- Have accumulated 100+ notes over months/years
- Feel guilty about unread content
- Want to actually _use_ what they've saved

**Secondary**: Knowledge workers looking for an alternative to NotebookLM or ChatGPT Projects with local-first, privacy-preserving design.

### Key Messages

1. **For the overwhelmed collector**: "You don't need another organization system. You need a reason to use what you already have."

2. **For the Copilot enthusiast**: "Your vault isn't a library—it's a workshop. Projects+ helps you build things with it."

---

## Appendix: Folder Path Configuration

Default structure:

```
copilot/
├── projects/                    # Projects+ goals
│   ├── build-portfolio/
│   │   ├── goal.md
│   │   └── conversations/
│   └── learn-typescript/
│       ├── goal.md
│       └── conversations/
└── ... (other copilot data)
```

Users can configure an alternative root path in settings, e.g., `goals/` or `projects/`.
