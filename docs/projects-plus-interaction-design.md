# Projects+ UI Design Document

> For Copilot for Obsidian — Separate Side Panel (MVP: Discuss-Only)

---

## Design Overview

### Product Context

Projects+ is a project-oriented workspace within Copilot for Obsidian. Users create projects, AI matches relevant notes from their vault, and they engage with knowledge through focused discussions. MVP focuses on the Discuss action only.

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

| Component                     | Location                            | Usage                  |
| ----------------------------- | ----------------------------------- | ---------------------- |
| Card, CardHeader, CardContent | `src/components/ui/card.tsx`        | Project cards          |
| Button (all variants)         | `src/components/ui/button.tsx`      | Actions                |
| Badge                         | `src/components/ui/badge.tsx`       | Status indicators      |
| ScrollArea                    | `src/components/ui/scroll-area.tsx` | Scrollable lists       |
| Dialog                        | `src/components/ui/dialog.tsx`      | Project creation modal |
| Input, Textarea               | `src/components/ui/input.tsx`       | Form fields            |
| Checkbox                      | `src/components/ui/checkbox.tsx`    | Note selection         |
| Collapsible                   | `src/components/ui/collapsible.tsx` | Expandable sections    |
| ChatMessages                  | `src/components/chat-components/`   | Discuss UI             |
| ChatInput                     | `src/components/chat-components/`   | Discuss input          |
| ChatSingleMessage             | `src/components/chat-components/`   | Message rendering      |
| SearchBar                     | `src/components/ui/SearchBar.tsx`   | Note filtering         |

### New Components (Build for Projects+)

| Component             | Purpose                                           |
| --------------------- | ------------------------------------------------- |
| ProjectsView          | Obsidian ItemView for separate panel              |
| ProjectCard           | Project preview with note count, activity         |
| ProjectList           | Home screen project listing with search           |
| ProjectDetail         | Project detail with notes, actions, conversations |
| ProjectCreationDialog | Dialog with left-right layout: form + chat        |
| NoteAssignment        | AI suggestions + manual note selection            |
| NoteCard              | Note display with checkbox, excerpt               |
| ConversationList      | Resumable conversation threads                    |
| ConversationItem      | Single conversation with topic, date              |

---

## Screen Specifications

---

## 1. First-Time Experience (Onboarding)

### Screen 1.1: Welcome

**Purpose**: Introduce the project-oriented philosophy

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
│   │    Create your first project│   │
│   └─────────────────────────────┘   │
│                                     │
│        Skip for now (ghost link)    │
│                                     │
└─────────────────────────────────────┘
```

**Interactions**:

- "Create your first project" → Opens Project Creation flow
- "Skip for now" → Shows empty Home screen with CTA

---

## 2. Home Screen (Project List)

### Screen 2.1: Empty State

**Purpose**: Encourage first project creation

```
┌─────────────────────────────────────┐
│  🎯 Projects+                  ⚙️   │
├─────────────────────────────────────┤
│                                     │
│                                     │
│      ┌───────────────────────┐      │
│      │   📋 (illustration)   │      │
│      │                       │      │
│      │   No active projects  │      │
│      │                       │      │
│      │   What are you trying │      │
│      │   to accomplish?      │      │
│      └───────────────────────┘      │
│                                     │
│   ┌─────────────────────────────┐   │
│   │    + Create a project       │   │
│   └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

### Screen 2.2: With Projects

**Purpose**: Quick overview and navigation to projects

```
┌─────────────────────────────────────┐
│  🎯 Projects+                  ⚙️   │
├─────────────────────────────────────┤
│                                     │
│  🔍 Search projects...              │
│                                     │
│  Active Projects (2)                │
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
│         │  + New Project  │         │
│         └─────────────────┘         │
│                                     │
└─────────────────────────────────────┘
```

**Project Card States**:

- Active: Normal opacity, full interaction
- Completed: Dashed border, muted colors, checkmark

**Interactions**:

- Click project card → Navigate to Project Detail
- Click "+ New Project" → Open Project Creation flow
- Click ⚙️ → Open Settings (Projects+ tab)
- "Show ▼" → Expand/collapse completed projects section
- Search → Filter projects by name

---

## 3. Project Creation (Dialog Flow)

Project creation uses a centered dialog modal (~800px wide) with a left-right layout for a spacious, focused experience.

### Screen 3.1: Project Creation Dialog

**Purpose**: Conversational project refinement with real-time form population in a dialog

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ✕                         Create New Project                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────┐ │ ┌─────────────────────────────────┐│
│  │ PROJECT DETAILS               │ │ │                                 ││
│  │ ───────────────────────────── │ │ │ 🤖 Let's define your project.   ││
│  │                               │ │ │    Tell me what you're trying   ││
│  │ Title                         │ │ │    to accomplish in your own    ││
│  │ ┌───────────────────────────┐ │ │ │    words.                       ││
│  │ │ Build portfolio website   │ │ │ │                                 ││
│  │ └───────────────────────────┘ │ │ │ ┌─────────────────────────────┐ ││
│  │                               │ │ │ │ I want to build a portfolio │ ││
│  │ Description                   │ │ │ │ website to land a frontend  │ ││
│  │ ┌───────────────────────────┐ │ │ │ │ dev job                     │ ││
│  │ │ Create a modern React-    │ │ │ │ └─────────────────────────────┘ ││
│  │ │ based portfolio site to   │ │ │ │                             You ││
│  │ │ showcase projects...      │ │ │ │                                 ││
│  │ │                           │ │ │ │ 🤖 Great! What will success     ││
│  │ └───────────────────────────┘ │ │ │    look like for this project?  ││
│  │                               │ │ │                                 ││
│  │ Success Criteria              │ │ │ ┌─────────────────────────────┐ ││
│  │ ┌───────────────────────────┐ │ │ │ │ Having a live site with 3-4 │ ││
│  │ │ • Live site deployed      │ │ │ │ │ projects that's responsive  │ ││
│  │ │ • 3-4 projects showcased  │ │ │ │ └─────────────────────────────┘ ││
│  │ │ • Mobile responsive       │ │ │ │                             You ││
│  │ └───────────────────────────┘ │ │ │                                 ││
│  │                               │ │ │ 🤖 Perfect! I've updated the    ││
│  │ Deadline (optional)           │ │ │    form. Ready to find relevant ││
│  │ ┌───────────────────────────┐ │ │ │    notes in your vault?         ││
│  │ │ 📅 Jan 15, 2026           │ │ │ │                                 ││
│  │ └───────────────────────────┘ │ │ ├─────────────────────────────────┤│
│  │                               │ │ │ ┌─────────────────────────┐  ➤  ││
│  └───────────────────────────────┘ │ │ │ Type response...        │     ││
│                                    │ │ └─────────────────────────┘     ││
│                                    │ └─────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────────┤
│                           Cancel              Find Relevant Notes →     │
└─────────────────────────────────────────────────────────────────────────┘
```

**Layout**:

- Left panel (~40%): Form with project details
- Right panel (~60%): Chat interface for conversational refinement
- Footer: Action buttons

**Form Fields** (left panel):

| Field            | Type          | Required | Notes                            |
| ---------------- | ------------- | -------- | -------------------------------- |
| Title            | Text input    | Yes      | Auto-populated from chat         |
| Description      | Textarea      | Yes      | AI-generated summary, editable   |
| Success Criteria | Textarea/List | Yes      | Bulleted list of success markers |
| Deadline         | Date picker   | No       | Optional target date             |

**AI Conversation Flow**:

1. "What are you trying to accomplish?" → Extracts title
2. "What will success look like for this project?" → Populates success criteria
3. "Can you describe this project in more detail?" → Builds description
4. "Let me suggest some notes..." → Transitions to note assignment

**Interactions**:

- Type message + Enter/click ➤ → Send message, form updates in real-time
- Edit form fields directly → Changes reflected immediately
- Click ✕ or "Cancel" → Confirm discard (if form has content), close dialog
- Click "Find Relevant Notes →" → Transition to Note Assignment (stays in dialog)

### Screen 3.2: Project Ready State

**Purpose**: Confirm project details before proceeding to note assignment

When AI detects the project is complete, the chat shows a ready message and the primary action becomes prominent.

**Visual Changes**:

- Left form shows ✓ checkmarks next to completed fields
- Right chat shows: "Looks good! Ready to find relevant notes in your vault?"
- Footer shows prominent "Find Relevant Notes →" button
- Secondary link: "Skip and add notes manually"

**Interactions**:

- "Find Relevant Notes →" → Transition to Note Assignment within dialog
- "Skip and add notes manually" → Create project, close dialog, show in side panel

---

## 4. AI Note Assignment (Inside Dialog)

Note assignment occurs within the same Project Creation dialog, maintaining context and flow.

### Screen 4.1: Scanning State

**Purpose**: Show progress while AI analyzes vault

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                      Assign Notes                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                                                                         │
│                                                                         │
│                     ┌───────────────────────────────┐                   │
│                     │                               │                   │
│                     │        🔍 (animated)          │                   │
│                     │                               │                   │
│                     │       Scanning vault          │                   │
│                     │                               │                   │
│                     │    Finding notes relevant     │                   │
│                     │    to your project...         │                   │
│                     │                               │                   │
│                     └───────────────────────────────┘                   │
│                                                                         │
│                                                                         │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                             Cancel      │
└─────────────────────────────────────────────────────────────────────────┘
```

### Screen 4.2: Note Suggestions

**Purpose**: Review and confirm AI-suggested notes

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← Back                      Assign Notes                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  For: Build portfolio website                                           │
│                                                                         │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │
│  │ 🤖 I found 12 notes about React, portfolios, and web dev that    │ │
│  │    could help with your project.                                 │ │
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │
│                                                                         │
│  ☑️ All  │  🔍 Search notes...                                          │
│  ───────────────────────────────────────────────────────────────────    │
│                                                                         │
│  [✓] React Best Practices                                         98%  │
│      "Component composition patterns for reusable UI..."               │
│                                                                         │
│  [✓] Portfolio Inspiration                                        94%  │
│      "Minimalist layouts and case study formats..."                    │
│                                                                         │
│  [✓] CSS Grid Guide                                               91%  │
│      "Grid template areas for responsive layouts..."                   │
│                                                                         │
│  [ ] Webpack Deep Dive                                            67%  │
│      "Code splitting and bundle optimization..."                       │
│                                                                         │
│  ───────────────────────────────────────────────────────────────────    │
│  + Browse vault for more notes                                          │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  8 notes selected                  Cancel         Confirm & Create →   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Note Card Details**:

- Checkbox: Toggle inclusion
- Title: Note filename
- Relevance %: AI confidence score (sorted high to low)
- Excerpt: First line or AI-generated summary

**Interactions**:

- Click ← Back → Return to Project Creation form
- Click checkbox → Toggle note selection
- Click "All" checkbox → Select/deselect all
- Click note row (not checkbox) → Expand to show full excerpt
- Search → Filter notes by title
- "+ Browse vault" → Open file picker within dialog
- "Confirm & Create →" → Create project, close dialog, show Project Detail in side panel

---

## 5. Project Detail Screen

### Screen 5.1: Active Project

**Purpose**: Central hub for project engagement

```
┌─────────────────────────────────────┐
│  ← Projects  Build portfolio website│
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
│  │  Chat about your project with AI││
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
2. **Description**: Project description (collapsible if long)
3. **Action**: Discuss action card
4. **Conversations**: Resumable conversation threads
5. **Notes**: Assigned notes with add option

**Interactions**:

- "Start →" on Discuss → Navigate to Discuss flow (new conversation)
- Click conversation → Resume that conversation
- Click note → Open in Obsidian
- "+ Add" on Notes → Open note picker modal
- "✓ Complete" → Open completion confirmation
- "⋯ More" → Menu: Edit project, Delete project

### Screen 5.2: Note Management

**Purpose**: Add/remove notes from project

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
│  ← Project        Discuss           │
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
│  │ Ask about your project...   │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Screen 6.2: Active Discussion

**Purpose**: Ongoing conversation with source attribution

```
┌─────────────────────────────────────┐
│  ← Project   Discuss                │
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

**Purpose**: Keep conversation focused on project (gentle redirect)

```
┌─────────────────────────────────────┐
│  ← Project   Discuss                │
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
│     portfolio website project!      │
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
│  │ Ask about your project...   │ ➤  │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

### Screen 6.4: Resume Conversation

**Purpose**: Continue a previous discussion thread

```
┌─────────────────────────────────────┐
│  ← Project   React patterns         │
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
- **Suggested Questions**: AI-generated prompts based on project and notes
- **Off-Topic Handling**: Friendly redirect keeping focus on project
- **Combined Knowledge**: AI uses notes + its own training for comprehensive answers
- **Auto-Save**: Conversations automatically save when navigating away
- **Resume Conversations**: Previous conversations accessible from Project Detail

**Auto-Save Behavior**:

- Conversations auto-save to `copilot/projects/[project]/conversations/[topic].md`
- AI auto-generates topic name from conversation content (e.g., "React patterns", "CSS approaches")
- Topic name generated after first meaningful exchange
- No user action required to save

---

## 7. Project Completion

### Screen 7.1: Completion Confirmation

**Purpose**: Mark project as done with optional reflection

```
┌─────────────────────────────────────┐
│  ✕ Cancel      Complete Project     │
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
│  This project will become read-only │
│  but you can still view its         │
│  history anytime.                   │
│                                     │
└─────────────────────────────────────┘
```

### Screen 7.2: Archived Project View

**Purpose**: Read-only historical record

```
┌─────────────────────────────────────┐
│  ← Projects  Build portfolio website│
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
│  │  Where project folders are created│    │
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

| Screen                 | Entry Point                               | Exit Points                                       |
| ---------------------- | ----------------------------------------- | ------------------------------------------------- |
| Welcome                | Panel first open                          | Home, Project Creation Dialog                     |
| Home                   | Panel open, Back from Project             | Project Detail, Project Creation Dialog, Settings |
| Project Creation (dlg) | "+ New Project", Command palette          | Cancel (close), Note Assignment (in dialog)       |
| Note Assignment        | "Find Relevant Notes" in dialog           | Back to form, Confirm & Create (close dlg)        |
| Project Detail         | Click project card, After project created | Home, Discuss, Note Management, Completion        |
| Discuss                | "Start" from Project, Click conversation  | Project Detail (auto-saved)                       |
| Note Management        | "+ Add" from Project                      | Project Detail                                    |
| Completion             | "Complete" from Project                   | Home                                              |
| Settings               | ⚙️ icon                                   | Close to previous                                 |

---

## Project Folder Structure

| Path                | Content                           | Created By             |
| ------------------- | --------------------------------- | ---------------------- |
| `copilot/projects/` | Projects+ root                    | First project creation |
| `[project-name]/`   | Project workspace                 | Project creation       |
| `project.md`        | Metadata, description, reflection | Project creation       |
| `conversations/`    | Auto-saved discussion threads     | First conversation     |
| `[topic].md`        | Individual conversation           | Discuss action (auto)  |

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
2. `ProjectCard` - Project preview with stats
3. `ProjectList` - Home screen with search
4. `ProjectDetail` - Project hub with sections
5. `ProjectCreationDialog` - Dialog with left-right layout (form + chat)
6. `NoteAssignment` - AI suggestions + selection (inside dialog)
7. `ConversationList` - Resumable threads
8. `ConversationItem` - Single conversation row
9. `ProjectsSettingsTab` - Settings UI component

### Suggested Build Order

1. ProjectsView (panel shell)
2. ProjectList + ProjectCard (Home screen)
3. ProjectCreationDialog (dialog with form + chat layout)
4. NoteAssignment (AI suggestions, integrated in dialog)
5. ProjectDetail + ConversationList
6. Discuss flow (reuse ChatMessages/ChatInput)
7. Project completion flow
8. ProjectsSettingsTab
