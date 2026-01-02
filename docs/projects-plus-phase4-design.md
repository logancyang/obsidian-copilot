# Projects+ Phase 4: Project Detail & Notes - Technical Design

## Overview

Phase 4 adds a comprehensive project detail view with full note management capabilities. This document outlines the user flows, component architecture, and implementation details.

## Design Decisions

| Decision                   | Choice                     | Rationale                                                                                          |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- |
| Detail View                | In-Panel Navigation        | Card click replaces list with detail view. Back button returns to list. Quick browsing experience. |
| Note Search (Suggest More) | Dialog Overlay             | AI-powered search opens in dialog. Requires full attention, doesn't clutter detail view.           |
| Vault Browse               | Obsidian FuzzySuggestModal | Use native Obsidian file picker. Fast, familiar, follows existing patterns.                        |
| Status Change              | Confirmation Dialog        | Opens dialog with journey summary. Prevents accidents, supports reflection on complete.            |

### Design Philosophy

- **Dialog**: Full attention actions (edit project, add notes, change status)
- **Side Panel**: Quick scan actions (view notes list, view conversations, navigate)

---

## Component Architecture

```
ProjectsPanel.tsx (Main Container)
  │
  ├── [selectedProjectId: string | null] ← Navigation state
  │
  ├── If selectedProjectId === null:
  │     └── List View
  │           ├── Header (title, New Project button)
  │           ├── Search/Filter bar
  │           └── ProjectList
  │                 └── ProjectCard[] (onClick → sets selectedProjectId)
  │
  └── If selectedProjectId !== null:
        └── ProjectDetail.tsx
              ├── ProjectEditDialog.tsx (via "Edit" button)
              ├── NoteSuggestionsDialog.tsx (via "Suggest Notes" button)
              ├── ProjectStatusDialog.tsx (via Complete/Archive)
              └── AddNoteModal.ts (via "Add Note" button)
```

---

## User Flows

### Flow 1: Navigate to Project Detail

```
┌─────────────────┐     click card    ┌─────────────────┐
│  ProjectsPanel  │ ─────────────────▶│  ProjectDetail  │
│   (List View)   │                   │                 │
└─────────────────┘                   └─────────────────┘
```

1. User is on ProjectsPanel (list view)
2. User clicks on a ProjectCard body (not menu)
3. `setSelectedProjectId(project.id)` is called
4. Panel re-renders showing ProjectDetail
5. ProjectDetail subscribes to ProjectManager for updates

### Flow 2: Return to List

```
┌─────────────────┐    click back     ┌─────────────────┐
│  ProjectDetail  │ ─────────────────▶│  ProjectsPanel  │
│                 │                   │   (List View)   │
└─────────────────┘                   └─────────────────┘
```

1. User is on ProjectDetail view
2. User clicks back button (← arrow)
3. `setSelectedProjectId(null)` is called
4. Panel re-renders showing list view

### Flow 3: Edit Project

```
┌─────────────────┐   click Edit    ┌───────────────────┐
│  ProjectDetail  │ ───────────────▶│ ProjectEditDialog │
│                 │                 │                   │
│                 │◀────────────────│  (save/cancel)    │
└─────────────────┘                 └───────────────────┘
```

1. User is on ProjectDetail, clicks "Edit" button
2. ProjectEditDialog opens with current project data
3. User modifies title, description, success criteria, or deadline
4. User clicks "Save Changes"
5. `ProjectManager.updateProject()` is called
6. Dialog closes, detail view updates via subscription

### Flow 4: Suggest More Notes (AI-powered)

```
┌─────────────────┐  click Suggest  ┌─────────────────────┐
│  ProjectDetail  │ ───────────────▶│ NoteSuggestionsDialog│
│                 │                 │                     │
│                 │◀────────────────│ (add selected/cancel)│
└─────────────────┘                 └─────────────────────┘
```

1. User clicks "Suggest Notes" button
2. NoteSuggestionsDialog opens
3. Auto-triggers AI search on mount
4. Shows loading state, then note suggestions
5. User selects desired notes
6. User clicks "Add Selected (N)"
7. `ProjectManager.addNotesToProject()` is called
8. Dialog closes, notes list updates

### Flow 5: Manually Add Note

```
┌─────────────────┐   click [+]    ┌──────────────────┐
│  ProjectDetail  │ ──────────────▶│   AddNoteModal   │
│                 │                │ (Obsidian fuzzy) │
│                 │◀───────────────│                  │
└─────────────────┘                └──────────────────┘
```

1. User clicks "+" (Add Note) button
2. AddNoteModal opens (Obsidian FuzzySuggestModal)
3. User types to filter, selects a note
4. `ProjectManager.addNoteToProject(path, manuallyAdded: true)` is called
5. Modal closes, notes list updates

### Flow 6: Remove Note

1. User hovers over a note in the notes section
2. × (remove) button appears
3. User clicks ×
4. `ProjectManager.removeNoteFromProject()` is called
5. Note disappears from list immediately

### Flow 7: Complete Project

```
┌─────────────────┐  click Complete ┌───────────────────┐
│  ProjectDetail  │ ───────────────▶│ ProjectStatusDialog│
│                 │                 │                   │
│                 │◀────────────────│ journey + reflect │
└─────────────────┘                 └───────────────────┘
```

1. User clicks "Complete" button
2. ProjectStatusDialog opens with `action: "complete"`
3. Shows journey summary (days active, notes count, conversations count)
4. User optionally writes reflection
5. User clicks "Complete Project"
6. `ProjectManager.completeProject(id, reflection)` is called
7. Dialog closes, status badge updates to "completed"

---

## Component Specifications

### 1. ProjectDetail.tsx

**Purpose**: Full project detail view displayed in the side panel.

**Layout**:

```
+------------------------------------------+
| [←] Project Title              [active]  |
+------------------------------------------+
| Description text here...                 |
|                                          |
| Deadline: Jan 15, 2025                   |
|                                          |
| Success Criteria:                        |
| • Complete TypeScript basics             |
| • Build 3 small projects                 |
+------------------------------------------+
| 3 notes • 0 conversations • 5 days       |
+------------------------------------------+
| Notes                    [Suggest] [+]   |
| +--------------------------------------+ |
| | typescript-basics.md           [×]   | |
| | advanced-patterns.md           [×]   | |
| | project-ideas.md (missing)     [×]   | |
| +--------------------------------------+ |
+------------------------------------------+
| Conversations                            |
| Coming in Phase 5...                     |
+------------------------------------------+
| [Edit]                        [Complete] |
+------------------------------------------+
```

**Props**:

```typescript
interface ProjectDetailProps {
  projectId: string;
  plugin: CopilotPlugin;
  onBack: () => void;
}
```

**Key Features**:

- Subscribe to ProjectManager for real-time updates
- Show notes with clickable titles (opens in Obsidian)
- Remove button (×) appears on hover
- Check note file existence, show warning if missing
- Status-aware action buttons

**Status-Aware Actions**:
| Status | Available Actions |
|--------|-------------------|
| active | Edit, Suggest Notes, Add Note, Complete, Archive |
| completed | Edit, Reactivate, Archive |
| archived | Reactivate |

### 2. ProjectEditDialog.tsx

**Purpose**: Enhanced edit dialog for all project metadata.

**Props**:

```typescript
interface ProjectEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onSave: (updates: UpdateProjectInput) => Promise<void>;
}
```

**Fields**:

- Title (Input) - required
- Description (Textarea)
- Success Criteria (SuccessCriteriaEditor component)
- Deadline (DatePicker component)

**Layout**:

```
+----------------------------------+
| Edit Project                 [×] |
+----------------------------------+
| Title *                          |
| [________________________]       |
|                                  |
| Description                      |
| [________________________]       |
| [________________________]       |
|                                  |
| Success Criteria                 |
| • [Criterion 1          ] [×]    |
| • [Criterion 2          ] [×]    |
| [+ Add criterion]                |
|                                  |
| Deadline                         |
| [📅 Jan 15, 2025      ] [clear]  |
+----------------------------------+
| [Cancel]         [Save Changes]  |
+----------------------------------+
```

### 3. NoteSuggestionsDialog.tsx

**Purpose**: Dialog wrapper for AI-powered note suggestions.

**Props**:

```typescript
interface NoteSuggestionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  noteAssignmentService: NoteAssignmentService;
  onAddNotes: (projectId: string, suggestions: NoteSuggestion[]) => Promise<void>;
  onOpenNote?: (path: string) => void;
}
```

**Behavior**:

- Auto-triggers search when dialog opens
- Reuses existing NoteSuggestions component
- Uses existing useNoteAssignment hook for state

**Layout**:

```
+--------------------------------------+
| Find Relevant Notes              [×] |
+--------------------------------------+
| [Searching vault...]                 |
| OR                                   |
| Found 8 relevant notes               |
|                                      |
| [×] typescript-basics.md      85%    |
|     Semantic match                   |
| [ ] advanced-patterns.md      72%    |
|     Both matches                     |
| ...                                  |
+--------------------------------------+
| [Cancel]       [Add Selected (2)]    |
+--------------------------------------+
```

### 4. ProjectStatusDialog.tsx

**Purpose**: Confirmation dialog for status changes with journey summary.

**Props**:

```typescript
type StatusAction = "complete" | "archive" | "reactivate";

interface ProjectStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  action: StatusAction;
  onConfirm: (reflection?: string) => Promise<void>;
}
```

**Layout for Complete**:

```
+--------------------------------------+
| Complete Project                 [×] |
+--------------------------------------+
| You've been working on this for      |
| 5 days with 3 notes and 0            |
| conversations.                       |
|                                      |
| Reflection (optional)                |
| [________________________]           |
| [________________________]           |
| [________________________]           |
|                                      |
| What did you learn or accomplish?    |
+--------------------------------------+
| [Cancel]          [Complete Project] |
+--------------------------------------+
```

**Layout for Archive/Reactivate**:

```
+--------------------------------------+
| Archive Project                  [×] |
+--------------------------------------+
| Are you sure you want to archive     |
| "Learn TypeScript"?                  |
|                                      |
| Archived projects can be reactivated |
| later.                               |
+--------------------------------------+
| [Cancel]                  [Archive]  |
+--------------------------------------+
```

### 5. AddNoteModal.ts

**Purpose**: Obsidian FuzzySuggestModal for manual note selection.

**Pattern**: Follows existing `AddContextNoteModal.tsx`.

```typescript
interface AddNoteModalProps {
  app: App;
  onNoteSelect: (notePath: string) => void;
  excludeNotePaths: string[];
}

export class AddNoteModal extends BaseNoteModal<TFile> {
  constructor({ app, onNoteSelect, excludeNotePaths }: AddNoteModalProps) {
    super(app, ChainType.COPILOT_PLUS_CHAIN);
    this.availableNotes = this.getOrderedNotes(excludeNotePaths);
    this.onNoteSelect = onNoteSelect;
  }

  getItems(): TFile[] {
    return this.availableNotes;
  }

  getItemText(note: TFile): string {
    return this.formatNoteTitle(note.basename, false, note.extension);
  }

  onChooseItem(note: TFile) {
    this.onNoteSelect(note.path);
  }
}
```

---

## Files to Modify

### 1. ProjectsPanel.tsx

**Changes**:

- Add `selectedProjectId: string | null` state
- Add `handleSelectProject` and `handleBackToList` callbacks
- Conditional render: detail view vs list view
- Pass `onSelectProject` to ProjectList

### 2. ProjectList.tsx

**Changes**:

- Add `onSelectProject: (projectId: string) => void` prop
- Pass `onClick` to each ProjectCard

### 3. ProjectCard.tsx

**Changes**:

- Add `onClick: () => void` prop for navigation
- Separate card body click (navigate) from menu click (actions)
- Card body → `onClick()` (navigate to detail)
- Menu "Edit" → `onEdit()` (still opens edit dialog from list)

---

## Implementation Considerations

### Real-time Updates

ProjectDetail must subscribe to ProjectManager:

```typescript
useEffect(() => {
  const unsubscribe = plugin.projectsPlusManager.subscribe(() => {
    const updated = plugin.projectsPlusManager.getProject(projectId);
    if (updated) {
      setProject(updated);
    } else {
      // Project was deleted externally
      onBack();
    }
  });
  return unsubscribe;
}, [plugin.projectsPlusManager, projectId, onBack]);
```

### Note File Existence Check

Display warning for missing notes:

```typescript
const noteFile = plugin.app.vault.getAbstractFileByPath(note.path);
const exists = noteFile instanceof TFile;
// If !exists, show warning badge and disable "open" action
```

### Journey Summary Calculation

```typescript
function calculateJourneySummary(project: Project): JourneySummary {
  const now = Date.now();
  const daysActive = Math.ceil((now - project.createdAt) / (1000 * 60 * 60 * 24));
  return {
    daysActive,
    notesCount: project.notes.length,
    conversationsCount: project.conversations.length,
  };
}
```

### Opening Notes in Obsidian

```typescript
plugin.app.workspace.openLinkText(notePath, "");
```

---

## File Structure After Phase 4

```
src/components/projects-plus/
├── ProjectsView.tsx           # Obsidian ItemView wrapper
├── ProjectsPanel.tsx          # Main container (MODIFIED)
├── ProjectList.tsx            # List of project cards (MODIFIED)
├── ProjectCard.tsx            # Individual card (MODIFIED)
├── ProjectDetail.tsx          # NEW: Full detail view
├── ProjectEditDialog.tsx      # NEW: Enhanced edit dialog
├── NoteSuggestionsDialog.tsx  # NEW: Note suggestions in dialog
├── ProjectStatusDialog.tsx    # NEW: Status change confirmation
├── ProjectCreationDialog.tsx  # Two-step creation (Phase 2)
├── ProjectForm.tsx            # Form in creation dialog
├── ProjectChat.tsx            # Chat in creation dialog
├── NoteSuggestions.tsx        # Note suggestions component
├── NoteCard.tsx               # Note suggestion card
├── SuccessCriteriaEditor.tsx  # Success criteria list editor
└── ...

src/components/modals/
├── AddNoteModal.ts            # NEW: Vault browser modal
├── AddContextNoteModal.tsx    # Existing (pattern to follow)
├── BaseNoteModal.tsx          # Base class for note modals
└── ...
```

---

## Testing Checklist

### Manual Verification

1. **Navigation**

   - [ ] Click project card → navigates to detail view
   - [ ] Click back button → returns to list view
   - [ ] List filters/search preserved after returning

2. **Project Detail Display**

   - [ ] Shows title, description, deadline
   - [ ] Shows success criteria list
   - [ ] Shows stats (notes, conversations, days)
   - [ ] Status badge displays correctly

3. **Edit Project**

   - [ ] Edit button opens dialog
   - [ ] All fields editable (title, description, criteria, deadline)
   - [ ] Save persists changes
   - [ ] Cancel discards changes

4. **Note Management**

   - [ ] Notes list displays assigned notes
   - [ ] Click note title → opens in Obsidian
   - [ ] × button removes note
   - [ ] Missing notes show warning
   - [ ] "Suggest Notes" opens dialog with AI search
   - [ ] "+" opens vault browser
   - [ ] Selected notes added to project

5. **Status Changes**

   - [ ] Complete button → shows journey summary + reflection
   - [ ] Archive button → shows confirmation
   - [ ] Reactivate button → shows confirmation
   - [ ] Status badge updates after change

6. **Persistence**
   - [ ] Changes persist after Obsidian reload
   - [ ] project.md file updated correctly

---

## Implementation Order

1. **ProjectDetail.tsx** - Core detail view with static layout
2. **ProjectsPanel.tsx** - Add navigation state and conditional render
3. **ProjectCard.tsx & ProjectList.tsx** - Update click behavior
4. **AddNoteModal.ts** - Manual note selection
5. **ProjectEditDialog.tsx** - Enhanced editing
6. **NoteSuggestionsDialog.tsx** - AI suggestions in dialog
7. **ProjectStatusDialog.tsx** - Status change confirmation
