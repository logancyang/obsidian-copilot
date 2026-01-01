# Projects+ UI Design Document

> For Copilot for Obsidian — Separate Side Panel (MVP: Discuss-Only)

---

## Design Overview

### Product Context

Projects+ is a goal-oriented workspace within Copilot for Obsidian. Users create goals, AI matches relevant notes from their vault, and they engage with knowledge through focused discussions. MVP focuses on the Discuss action only.

### Interaction Model

- **Primary UI**: Separate right-side panel (400px width, full height)
- **Settings**: New tab within Copilot settings modal
- **Notifications**: Toast messages (bottom-right, using existing Obsidian notices)

### Visual Style: Obsidian-Native

Projects+ inherits Copilot's existing visual language to maintain consistency:

- **Colors**: Use Obsidian CSS variables (see tailwind.config.js)
  - Background: `--background-primary`, `--background-secondary`
  - Text: `--text-normal`, `--text-muted`, `--text-faint`
  - Accent: `--interactive-accent`, `--interactive-accent-hover`
  - Success: `--color-green`
  - Warning: `--color-yellow`
  - Error: `--color-red`
- **Typography**: System font stack (Obsidian defaults)
- **Radius**: Use existing `--radius-s` (4px), `--radius-m` (8px), `--radius-l` (12px)
- **Spacing**: Use Obsidian's `--size-4-*` variables

### Tailwind Prefix

All Tailwind classes use `tw-` prefix per project configuration.

---

## Component Reuse Strategy

### From Copilot (Reuse Directly)

| Component                     | Location                            | Usage               |
| ----------------------------- | ----------------------------------- | ------------------- |
| Card, CardHeader, CardContent | `src/components/ui/card.tsx`        | Goal cards          |
| Button (all variants)         | `src/components/ui/button.tsx`      | Actions             |
| Badge                         | `src/components/ui/badge.tsx`       | Status indicators   |
| ScrollArea                    | `src/components/ui/scroll-area.tsx` | Scrollable lists    |
| Dialog                        | `src/components/ui/dialog.tsx`      | Goal creation modal |
| Input, Textarea               | `src/components/ui/input.tsx`       | Form fields         |
| Checkbox                      | `src/components/ui/checkbox.tsx`    | Note selection      |
| Collapsible                   | `src/components/ui/collapsible.tsx` | Expandable sections |
| ChatMessages                  | `src/components/chat-components/`   | Discuss UI          |
| ChatInput                     | `src/components/chat-components/`   | Discuss input       |
| ChatSingleMessage             | `src/components/chat-components/`   | Message rendering   |
| SearchBar                     | `src/components/ui/SearchBar.tsx`   | Note filtering      |

### New Components (Build for Projects+)

| Component        | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| ProjectsView     | Obsidian ItemView for separate panel           |
| GoalCard         | Goal preview with note count, activity         |
| GoalList         | Home screen goal listing with search           |
| GoalDetail       | Goal detail with notes, actions, conversations |
| GoalCreationFlow | Hybrid chat + live form                        |
| NoteAssignment   | AI suggestions + manual note selection         |
| NoteCard         | Note display with checkbox, excerpt            |
| ConversationList | Resumable conversation threads                 |
| ConversationItem | Single conversation with topic, date           |

---

## Screen Specifications

---

## 1. First-Time Experience (Onboarding)

### Screen 1.1: Welcome

**Purpose**: Introduce the goal-oriented philosophy

```
┌─────────────────────────────────────┐
│                                     │
│         🎯 (target icon)            │
│                                     │
│         Welcome to Projects+        │
│                                     │
│    "Your notes aren't a library.    │
│     They're a workshop waiting      │
│       for a purpose."               │
│                                     │
│   ┌─────────────────────────────┐   │
│   │    Create your first goal   │   │
│   └─────────────────────────────┘   │
│                                     │
│        Skip for now (ghost link)    │
│                                     │
└─────────────────────────────────────┘
```

**Interactions**:

- "Create your first goal" → Opens Goal Creation flow
- "Skip for now" → Shows empty Home screen with CTA

---

## 2. Home Screen (Goal List)

### Screen 2.1: Empty State

**Purpose**: Encourage first goal creation

```
┌─────────────────────────────────────┐
│  🎯 Projects+                  ⚙️   │
├─────────────────────────────────────┤
│                                     │
│                                     │
│      ┌───────────────────────┐      │
│      │   📋 (illustration)   │      │
│      │                       │      │
│      │   No active goals     │      │
│      │                       │      │
│      │   What are you trying │      │
│      │   to accomplish?      │      │
│      └───────────────────────┘      │
│                                     │
│   ┌─────────────────────────────┐   │
│   │    + Create a goal          │   │
│   └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

### Screen 2.2: With Goals

**Purpose**: Quick overview and navigation to goals

```
┌─────────────────────────────────────┐
│  🎯 Projects+                  ⚙️   │
├─────────────────────────────────────┤
│                                     │
│  🔍 Search goals...                 │
│                                     │
│  Active Goals (2)                   │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Build portfolio website         ││
│  │ 📄 12 notes  💬 3 conversations ││
│  │ Last active: 2 hours ago        ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │ System design interviews        ││
│  │ 📄 24 notes  💬 1 conversation  ││
│  │ Last active: 3 days ago         ││
│  └─────────────────────────────────┘│
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  Completed (1)              Show ▼  │
│                                     │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐│
│  │ ✓ Learn TypeScript basics     ││
│  │   Completed Dec 15            ││
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘│
│                                     │
│         ┌─────────────────┐         │
│         │  + New Goal     │         │
│         └─────────────────┘         │
│                                     │
└─────────────────────────────────────┘
```

**Goal Card States**:

- Active: Normal opacity, full interaction
- Completed: Dashed border, muted colors, checkmark

**Interactions**:

- Click goal card → Navigate to Goal Detail
- Click "+ New Goal" → Open Goal Creation flow
- Click ⚙️ → Open Settings (Projects+ tab)
- "Show ▼" → Expand/collapse completed goals section
- Search → Filter goals by name

---

## 3. Goal Creation (Hybrid Flow)

### Screen 3.1: Chat + Form Layout

**Purpose**: Conversational goal refinement with real-time form population

```
┌─────────────────────────────────────┐
│  ← Back          Creating Goal      │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │ GOAL PREVIEW              Live ││
│  │ ─────────────────────────────  ││
│  │ Name: Build portfolio website  ││
│  │ Description: Create a personal ││
│  │ site to showcase my React...   ││
│  │ Deadline: (optional)           ││
│  │                                ││
│  │ [Edit manually]                ││
│  └─────────────────────────────────┘│
│                                     │
│  ───────── Chat ─────────────────── │
│                                     │
│  🤖 What are you trying to          │
│     accomplish? Tell me about       │
│     your goal in your own words.    │
│                                     │
│     ┌─────────────────────────────┐ │
│     │ I want to build a portfolio │ │
│     │ website to land a frontend  │ │
│     │ dev job                     │ │
│     └─────────────────────────────┘ │
│                                 You │
│                                     │
│  🤖 Great! A portfolio site for     │
│     job hunting. What technologies  │
│     are you planning to use?        │
│                                     │
│     I have the form updating as we  │
│     chat ↑                          │
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ Type your response...       │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**Form Fields** (in Goal Preview):

- Name (required): Auto-populated from chat, editable
- Description (required): AI-generated summary, editable
- Deadline (optional): Date picker

**AI Conversation Flow**:

1. "What are you trying to accomplish?" → Extracts goal name
2. "What will success look like?" → Builds description
3. "When do you want to finish this?" (optional) → Sets deadline
4. "Let me suggest some notes..." → Transitions to note assignment

**Interactions**:

- Type message + Enter/click ➤ → Send message
- Click "Edit manually" → Expand form for direct editing
- Click "← Back" → Confirm discard, return to Home
- AI detects completeness → Shows "Find Notes" button

### Screen 3.2: Goal Ready State

**Purpose**: Confirm goal details before proceeding to note assignment

```
┌─────────────────────────────────────┐
│  ← Back          Creating Goal      │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │ ✨ GOAL READY                  ││
│  │ ─────────────────────────────  ││
│  │ Name: Build portfolio website  ││
│  │                                ││
│  │ Description: Create a modern   ││
│  │ React-based portfolio site     ││
│  │ showcasing 3-4 projects to     ││
│  │ support job applications.      ││
│  │                                ││
│  │ Deadline: Jan 15, 2026         ││
│  │            (14 days from now)  ││
│  │                                ││
│  │ [Edit]                         ││
│  └─────────────────────────────────┘│
│                                     │
│  🤖 Looks good! Ready to find       │
│     relevant notes in your vault?   │
│                                     │
│  ┌─────────────────────────────────┐│
│  │  🔍 Find Relevant Notes         ││
│  └─────────────────────────────────┘│
│                                     │
│  Or skip and add notes manually     │
│                                     │
└─────────────────────────────────────┘
```

**Interactions**:

- "Find Relevant Notes" → Proceed to AI Note Assignment
- "skip and add notes manually" → Create goal, go to Goal Detail

---

## 4. AI Note Assignment

### Screen 4.1: Scanning State

**Purpose**: Show progress while AI analyzes vault

```
┌─────────────────────────────────────┐
│  ← Back       Assigning Notes       │
├─────────────────────────────────────┤
│                                     │
│                                     │
│                                     │
│         ┌───────────────────┐       │
│         │                   │       │
│         │   🔍 (animated)   │       │
│         │                   │       │
│         │  Scanning vault   │       │
│         │                   │       │
│         │  Finding notes    │       │
│         │  relevant to your │       │
│         │  goal...          │       │
│         │                   │       │
│         └───────────────────┘       │
│                                     │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

### Screen 4.2: Note Suggestions

**Purpose**: Review and confirm AI-suggested notes

```
┌─────────────────────────────────────┐
│  ← Back       Assigning Notes       │
├─────────────────────────────────────┤
│                                     │
│  For: Build portfolio website       │
│                                     │
│  AI found 12 relevant notes         │
│                                     │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐ │
│  │ 🤖 These notes contain info    │ │
│  │ about React, portfolios, and   │ │
│  │ web development that could     │ │
│  │ help with your goal.           │ │
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘ │
│                                     │
│  ☑️ All  │  🔍 Search notes         │
│  ─────────────────────────────────  │
│                                     │
│  [✓] React Best Practices      98%  │
│      "Component composition..."     │
│                                     │
│  [✓] Portfolio Inspiration     94%  │
│      "Minimalist layouts..."        │
│                                     │
│  [✓] CSS Grid Guide            91%  │
│      "Grid template areas..."       │
│                                     │
│  [ ] Webpack Deep Dive         67%  │
│      "Code splitting..."            │
│                                     │
│  ─────────────────────────────────  │
│  + Browse vault for more notes      │
│                                     │
├─────────────────────────────────────┤
│  8 notes selected                   │
│  ┌─────────────────────────────────┐│
│  │      Confirm & Create Goal      ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

**Note Card Details**:

- Checkbox: Toggle inclusion
- Title: Note filename
- Relevance %: AI confidence score (sorted high to low)
- Excerpt: First line or AI-generated summary

**Interactions**:

- Click checkbox → Toggle note selection
- Click "All" checkbox → Select/deselect all
- Click note row (not checkbox) → Expand to show full excerpt
- Search → Filter notes by title
- "+ Browse vault" → Open file picker modal
- "Confirm & Create Goal" → Create goal, navigate to Goal Detail

---

## 5. Goal Detail Screen

### Screen 5.1: Active Goal

**Purpose**: Central hub for goal engagement

```
┌─────────────────────────────────────┐
│  ← Goals    Build portfolio website │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │  📄 12 notes  💬 3 conversations││
│  └─────────────────────────────────┘│
│                                     │
│  Create a modern React-based        │
│  portfolio site showcasing 3-4      │
│  projects to support job apps.      │
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  ACTION                             │
│                                     │
│  ┌─────────────────────────────────┐│
│  │  💬 Discuss                     ││
│  │  Chat about your goal with AI   ││
│  │                        Start →  ││
│  └─────────────────────────────────┘│
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  CONVERSATIONS                      │
│                                     │
│  ┌─────────────────────────────────┐│
│  │  React patterns       Dec 28   ││
│  │  CSS approaches       Dec 26   ││
│  │  Project structure    Dec 24   ││
│  └─────────────────────────────────┘│
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  NOTES (12)                  + Add  │
│                                     │
│  ┌─────────────────────────────────┐│
│  │  📄 React Best Practices       ││
│  │  📄 Portfolio Inspiration      ││
│  │  📄 CSS Grid Guide             ││
│  │  ... (scrollable)              ││
│  └─────────────────────────────────┘│
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────┐ ┌────────────┐ │
│  │  ✓ Complete     │ │  ⋯ More   │ │
│  └─────────────────┘ └────────────┘ │
└─────────────────────────────────────┘
```

**Sections**:

1. **Header Stats**: Note count, conversation count
2. **Description**: Goal description (collapsible if long)
3. **Action**: Discuss action card
4. **Conversations**: Resumable conversation threads
5. **Notes**: Assigned notes with add option

**Interactions**:

- "Start →" on Discuss → Navigate to Discuss flow (new conversation)
- Click conversation → Resume that conversation
- Click note → Open in Obsidian
- "+ Add" on Notes → Open note picker modal
- "✓ Complete" → Open completion confirmation
- "⋯ More" → Menu: Edit goal, Delete goal

### Screen 5.2: Note Management

**Purpose**: Add/remove notes from goal

```
┌─────────────────────────────────────┐
│  ✕ Close         Manage Notes       │
├─────────────────────────────────────┤
│                                     │
│  🔍 Search your vault...            │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  ASSIGNED (12)                      │
│                                     │
│  [✓] React Best Practices       ✕   │
│  [✓] Portfolio Inspiration      ✕   │
│  [✓] CSS Grid Guide             ✕   │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  SUGGESTIONS                        │
│                                     │
│  [ ] Deployment Strategies     78%  │
│  [ ] Next.js Tutorial          72%  │
│                                     │
│  ─────────────────────────────────  │
│                                     │
│  ALL VAULT NOTES                    │
│                                     │
│  [ ] Daily Note 2024-12-28          │
│  [ ] Meeting Notes - Team           │
│  [ ] Random Thoughts                │
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │           Save Changes          ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

## 6. Discuss Action Flow

### Screen 6.1: New Conversation Start

**Purpose**: Start a new discussion

```
┌─────────────────────────────────────┐
│  ← Goal           Discuss           │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │ 🤖 I can help you explore your  ││
│  │ knowledge about building your   ││
│  │ portfolio website. Ask me       ││
│  │ anything!                       ││
│  │                                 ││
│  │ I'll draw from your 12 notes    ││
│  │ plus my own knowledge.          ││
│  └─────────────────────────────────┘│
│                                     │
│  Suggested questions:               │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐│
│  │ What React patterns should I   ││
│  │ use for my portfolio?          ││
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘│
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐│
│  │ How should I structure my      ││
│  │ project sections?              ││
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘│
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ Ask about your goal...      │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Screen 6.2: Active Discussion

**Purpose**: Ongoing conversation with source attribution

```
┌─────────────────────────────────────┐
│  ← Goal      Discuss                │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │ What React patterns should I   ││
│  │ use for my portfolio?          ││
│  └─────────────────────────────────┘│
│                                 You │
│                                     │
│  🤖 Based on your notes and best    │
│     practices, here are the key     │
│     patterns for a portfolio:       │
│                                     │
│     1. **Component Composition**    │
│        Break your portfolio into    │
│        reusable sections: Header,   │
│        ProjectCard, SkillBadge...   │
│                                     │
│     2. **Custom Hooks**             │
│        Use hooks like useScrollTo   │
│        for smooth navigation...     │
│                                     │
│     ┌───────────────────────────┐   │
│     │ 📄 Sources                │   │
│     │ • React Best Practices    │   │
│     │ • Portfolio Inspiration   │   │
│     └───────────────────────────┘   │
│                                     │
│  (scrollable conversation)          │
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ Ask follow-up...            │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Screen 6.3: Off-Topic Redirect

**Purpose**: Keep conversation focused on goal (gentle redirect)

```
┌─────────────────────────────────────┐
│  ← Goal      Discuss                │
├─────────────────────────────────────┤
│                                     │
│  ... (previous messages)            │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ What's the best restaurant     ││
│  │ in San Francisco?              ││
│  └─────────────────────────────────┘│
│                                 You │
│                                     │
│  🤖 That's a fun question, but      │
│     let me keep us focused on your  │
│     portfolio website goal!         │
│                                     │
│     Some things I can help with:    │
│     • React implementation advice   │
│     • Portfolio structure decisions │
│     • CSS and styling approaches    │
│     • Deployment strategies         │
│                                     │
│     What would you like to explore? │
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ Ask about your goal...      │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Screen 6.4: Resume Conversation

**Purpose**: Continue a previous discussion thread

```
┌─────────────────────────────────────┐
│  ← Goal      React patterns         │
├─────────────────────────────────────┤
│                                     │
│  Dec 28                             │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ What React patterns should I   ││
│  │ use for my portfolio?          ││
│  └─────────────────────────────────┘│
│                                 You │
│                                     │
│  🤖 Based on your notes and best    │
│     practices, here are the key     │
│     patterns for a portfolio:       │
│     ...                             │
│                                     │
│  ┌─────────────────────────────────┐│
│  │ Should I use CSS-in-JS or      ││
│  │ regular CSS for styling?       ││
│  └─────────────────────────────────┘│
│                                 You │
│                                     │
│  🤖 Great question! Your notes      │
│     mention both approaches...      │
│                                     │
│  ─────────── Resumed ─────────────  │
│                                     │
│  (continue conversation here)       │
│                                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐    │
│  │ Continue discussion...      │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

**Key Features**:

- **Source Attribution**: Expandable "Sources" section shows which notes informed the answer
- **Note Links**: Click to open referenced note in Obsidian
- **Suggested Questions**: AI-generated prompts based on goal and notes
- **Off-Topic Handling**: Friendly redirect keeping focus on goal
- **Combined Knowledge**: AI uses notes + its own training for comprehensive answers
- **Auto-Save**: Conversations automatically save when navigating away
- **Resume Conversations**: Previous conversations accessible from Goal Detail

**Auto-Save Behavior**:

- Conversations auto-save to `copilot/projects/[goal]/conversations/[topic].md`
- AI auto-generates topic name from conversation content (e.g., "React patterns", "CSS approaches")
- Topic name generated after first meaningful exchange
- No user action required to save

---

## 7. Goal Completion

### Screen 7.1: Completion Confirmation

**Purpose**: Mark goal as done with optional reflection

```
┌─────────────────────────────────────┐
│  ✕ Cancel      Complete Goal        │
├─────────────────────────────────────┤
│                                     │
│         🎯 (target icon)            │
│                                     │
│        Ready to complete            │
│    "Build portfolio website"?       │
│                                     │
│  ┌─────────────────────────────────┐│
│  │  Journey summary               ││
│  │  ───────────────────────────   ││
│  │  📄 12 notes engaged           ││
│  │  💬 3 conversations            ││
│  │  📅 14 days active             ││
│  └─────────────────────────────────┘│
│                                     │
│  Optional: Add a reflection         │
│  ┌─────────────────────────────────┐│
│  │ What I learned...               ││
│  │                                 ││
│  │                                 ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │     ✓ Mark as Complete          ││
│  └─────────────────────────────────┘│
│                                     │
│  This goal will become read-only    │
│  but you can still view its         │
│  history anytime.                   │
│                                     │
└─────────────────────────────────────┘
```

### Screen 7.2: Archived Goal View

**Purpose**: Read-only historical record

```
┌─────────────────────────────────────┐
│  ← Goals    Build portfolio website │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────────┐│
│  │  ✓ COMPLETED                   ││
│  │  Finished Dec 28, 2025         ││
│  └─────────────────────────────────┘│
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  REFLECTION                         │
│  "Learned a lot about React         │
│  component patterns and CSS Grid.   │
│  Site is live at..."                │
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  STATS                              │
│  📄 12 notes used                   │
│  💬 3 conversations                 │
│  📅 14 days from start to finish    │
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  CONVERSATIONS (read-only)          │
│  • React patterns (Dec 28)          │
│  • CSS approaches (Dec 26)          │
│  • Project structure (Dec 24)       │
│                                     │
│  ═══════════════════════════════    │
│                                     │
│  NOTES (read-only list)             │
│                                     │
└─────────────────────────────────────┘
```

---

## 8. Settings Tab

### Screen 8.1: Projects+ Settings

**Purpose**: Configure Projects+ behavior (within Copilot settings modal)

```
┌───────────────────────────────────────────┐
│                                           │
│  ┌───────────────────────────────────┐    │
│  │  General | QA | Projects+ | ...  │    │
│  ├───────────────────────────────────┤    │
│  │                                   │    │
│  │  Projects+ Settings               │    │
│  │  ─────────────────────────────    │    │
│  │                                   │    │
│  │  Projects folder path             │    │
│  │  ┌─────────────────────────────┐  │    │
│  │  │ copilot/projects           │  │    │
│  │  └─────────────────────────────┘  │    │
│  │  Where goal folders are created   │    │
│  │                                   │    │
│  │  Auto-save conversations          │    │
│  │  ┌──────┐                         │    │
│  │  │  ✓  │  Enabled                │    │
│  │  └──────┘                         │    │
│  │  Save discussions automatically   │    │
│  │                                   │    │
│  │  Note suggestion count            │    │
│  │  ┌─────────────────────────────┐  │    │
│  │  │ 10                       ▼ │  │    │
│  │  └─────────────────────────────┘  │    │
│  │  Notes to suggest during creation │    │
│  │                                   │    │
│  │  Excluded folders                 │    │
│  │  ┌─────────────────────────────┐  │    │
│  │  │ templates/, archive/       │  │    │
│  │  └─────────────────────────────┘  │    │
│  │  Folders to exclude from search   │    │
│  │                                   │    │
│  └───────────────────────────────────┘    │
│                                           │
└───────────────────────────────────────────┘
```

---

## Interaction Summary

| Screen          | Entry Point                           | Exit Points                                |
| --------------- | ------------------------------------- | ------------------------------------------ |
| Welcome         | Panel first open                      | Home, Goal Creation                        |
| Home            | Panel open, Back from Goal            | Goal Detail, Goal Creation, Settings       |
| Goal Creation   | "+ New Goal"                          | Home (cancel), Note Assignment             |
| Note Assignment | Goal creation complete                | Goal Detail                                |
| Goal Detail     | Click goal card                       | Home, Discuss, Note Management, Completion |
| Discuss         | "Start" from Goal, Click conversation | Goal Detail (auto-saved)                   |
| Note Management | "+ Add" from Goal                     | Goal Detail                                |
| Completion      | "Complete" from Goal                  | Home                                       |
| Settings        | ⚙️ icon                               | Close to previous                          |

---

## Goal Folder Structure

| Path                | Content                           | Created By            |
| ------------------- | --------------------------------- | --------------------- |
| `copilot/projects/` | Projects+ root                    | First goal creation   |
| `[goal-name]/`      | Goal workspace                    | Goal creation         |
| `goal.md`           | Metadata, description, reflection | Goal creation         |
| `conversations/`    | Auto-saved discussion threads     | First conversation    |
| `[topic].md`        | Individual conversation           | Discuss action (auto) |

---

## Implementation Notes

### Panel Registration

Register Projects+ as a separate Obsidian view:

```typescript
// Similar to CopilotView but separate view type
const PROJECTS_VIEW_TYPE = "copilot-projects-view";

class ProjectsView extends ItemView {
  getViewType(): string {
    return PROJECTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Projects+";
  }

  getIcon(): string {
    return "target"; // or custom icon
  }
}
```

### Key Components to Build

1. `ProjectsView` - Obsidian ItemView wrapper
2. `GoalCard` - Goal preview with stats
3. `GoalList` - Home screen with search
4. `GoalDetail` - Goal hub with sections
5. `GoalCreationFlow` - Hybrid chat + form
6. `NoteAssignment` - AI suggestions + selection
7. `ConversationList` - Resumable threads
8. `ConversationItem` - Single conversation row
9. `ProjectsSettingsTab` - Settings UI component

### Suggested Build Order

1. ProjectsView (panel shell)
2. GoalList + GoalCard (Home screen)
3. GoalCreationFlow (hybrid flow)
4. NoteAssignment (AI suggestions)
5. GoalDetail + ConversationList
6. Discuss flow (reuse ChatMessages/ChatInput)
7. Goal completion flow
8. ProjectsSettingsTab
