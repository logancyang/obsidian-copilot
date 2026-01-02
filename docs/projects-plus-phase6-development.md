# Projects+ Phase 6: Goal Completion & Settings - Development Document

## Overview

Phase 6 completes the Projects+ MVP by implementing goal completion workflows with reflection, archived goal views, and a dedicated settings tab. This document provides detailed implementation guidance, edge cases, and UI specifications.

---

## Table of Contents

1. [Goal Completion Flow](#1-goal-completion-flow)
2. [Archived Goals View](#2-archived-goals-view)
3. [Projects+ Settings Tab](#3-projects-settings-tab)
4. [Implementation Details](#4-implementation-details)
5. [Edge Cases & Error Handling](#5-edge-cases--error-handling)
6. [Testing Checklist](#6-testing-checklist)

---

## 1. Goal Completion Flow

### 1.1 Triggering the Completion Modal

The completion modal can be triggered from multiple locations:

#### Entry Points

| Location                     | UI Element                  | Action                                               |
| ---------------------------- | --------------------------- | ---------------------------------------------------- |
| **ProjectDetail Footer**     | "Complete" button (primary) | Opens `ProjectStatusDialog` with `action="complete"` |
| **ProjectCard Context Menu** | "Complete" menu item        | Opens `ProjectStatusDialog` with `action="complete"` |
| **ProjectCard Quick Action** | Checkmark icon button       | Opens `ProjectStatusDialog` with `action="complete"` |

#### Current Implementation

The completion flow is already wired in `ProjectDetail.tsx`:

```typescript
// ProjectDetail.tsx:430-431
<Button onClick={() => handleStatusAction("complete")}>
  <Check className="tw-mr-2 tw-size-4" />
  Complete
</Button>
```

This triggers `handleStatusAction("complete")` which opens `ProjectStatusDialog`:

```typescript
// ProjectDetail.tsx:135-138
const handleStatusAction = useCallback((action: StatusAction) => {
  setStatusAction(action);
  setStatusDialogOpen(true);
}, []);
```

### 1.2 Completion Modal UI Specification

The `ProjectStatusDialog` renders different content based on the action type. For completion:

```
┌─────────────────────────────────────────────────────────┐
│  Complete Project                                    [X] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  You've been working on this project for **5 days** │ │
│  │  with **12 notes** and **3 conversations**.         │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  Reflection (optional)                                  │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                                                     │ │
│  │  What did you learn or accomplish?                  │ │
│  │                                                     │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│                        [Cancel]  [Complete Project]     │
└─────────────────────────────────────────────────────────┘
```

#### Journey Summary Component

The journey summary uses `calculateJourneySummary()` from `utils.ts`:

```typescript
// utils.ts
export function calculateJourneySummary(project: Project) {
  const now = Date.now();
  const daysActive = Math.ceil((now - project.createdAt) / (1000 * 60 * 60 * 24));

  return {
    daysActive,
    notesCount: project.notes.length,
    conversationsCount: project.conversations.length,
  };
}
```

### 1.3 Completion Confirmation Handler

```typescript
// ProjectDetail.tsx:140-155
const handleConfirmStatus = useCallback(
  async (reflection?: string) => {
    switch (statusAction) {
      case "complete":
        await plugin.projectsPlusManager.completeProject(projectId, reflection);
        break;
      case "archive":
        await plugin.projectsPlusManager.archiveProject(projectId);
        break;
      case "reactivate":
        await plugin.projectsPlusManager.reactivateProject(projectId);
        break;
    }
  },
  [plugin.projectsPlusManager, projectId, statusAction]
);
```

### 1.4 Project Status Transitions

```
           ┌──────────────┐
           │    active    │
           └──────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
┌──────────────┐    ┌──────────────┐
│  completed   │    │   archived   │
└──────────────┘    └──────────────┘
        │                   │
        └─────────┬─────────┘
                  ▼
           ┌──────────────┐
           │    active    │  (reactivate)
           └──────────────┘
```

---

## 2. Archived Goals View

### 2.1 Goal List Filtering Behavior

**Design Decision:** Completed goals are NOT shown in the main list by default. Users must use the status filter dropdown to view them.

The `ProjectsPanel` already implements this via a status filter:

```typescript
// ProjectsPanel.tsx:167-176
<select value={filter} onChange={(e) => setFilter(e.target.value as FilterStatus)}>
  <option value="all">All</option>
  <option value="active">Active</option>
  <option value="completed">Completed</option>
  <option value="archived">Archived</option>
</select>
```

### 2.2 Default Filter Behavior

The default filter is `"all"` which shows all projects. However, projects are sorted by `updatedAt` descending, so active projects with recent activity appear first.

**Implementation Note:** There is no separate setting for "show completed in list" - the filter dropdown provides this functionality directly.

### 2.3 Completed/Archived Project Detail View

When viewing a completed or archived project, the UI should reflect the read-only nature:

#### Visual Indicators

1. **Status Badge** - Shows "Completed" or "Archived" with appropriate styling
2. **Reflection Section** - Displays the reflection text (if provided)
3. **Disabled Actions** - "Add Notes", "Suggest Notes" buttons hidden for non-active projects

Current implementation in `ProjectDetail.tsx`:

```typescript
// Notes section actions - only shown for active projects
{project.status === "active" && (
  <div className="tw-flex tw-gap-1">
    <Button variant="ghost" size="sm" onClick={() => setSuggestDialogOpen(true)}>
      <Sparkles className="tw-size-3" />
      Suggest
    </Button>
    <Button variant="ghost" size="sm" onClick={handleOpenAddNoteModal}>
      <Plus className="tw-size-3" />
      Add
    </Button>
  </div>
)}
```

#### Footer Actions by Status

| Status      | Available Actions         |
| ----------- | ------------------------- |
| `active`    | Edit, Archive, Complete   |
| `completed` | Edit, Archive, Reactivate |
| `archived`  | Edit, Reactivate          |

### 2.4 ProjectStatusBadge Component

Create a reusable badge component for consistent status display:

```typescript
// src/components/projects-plus/ProjectStatusBadge.tsx
interface ProjectStatusBadgeProps {
  status: ProjectStatus;
  className?: string;
}

export function ProjectStatusBadge({ status, className }: ProjectStatusBadgeProps) {
  return (
    <span className={cn(
      "tw-rounded-sm tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-capitalize",
      getStatusBadgeStyles(status),
      className
    )}>
      {status}
    </span>
  );
}
```

The `getStatusBadgeStyles` function from `utils.ts`:

```typescript
export function getStatusBadgeStyles(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "tw-bg-modifier-success-rgb/20 tw-text-success";
    case "completed":
      return "tw-bg-blue-rgb/20 tw-text-context-manager-blue";
    case "archived":
      return "tw-bg-modifier-hover tw-text-muted";
    default:
      return "";
  }
}
```

---

## 3. Projects+ Settings Tab

### 3.1 Settings Tab Location

Add a new tab to `SettingsMainV2.tsx` OR integrate into an existing tab.

**Recommended Approach:** Integrate into the existing settings structure rather than adding a new tab. Projects+ settings should be part of the "Plus" or "Advanced" tab since Projects+ is a premium feature.

### 3.2 Settings Interface

Based on the design decisions:

```typescript
// Settings that will be added to CopilotSettings
interface ProjectsPlusSettings {
  /** Folder path for Projects+ data */
  projectsPlusFolder: string; // Already exists, default: "copilot/projects"

  // REMOVED SETTINGS:
  // projectsPlusEnabled: boolean; - REMOVED (feature always enabled)
  // autoSaveEnabled: boolean; - REMOVED (always enabled)
  // defaultDiscussModel: string; - REMOVED (uses main model)
  // showCompletedInList: boolean; - REMOVED (use filter dropdown instead)
  // noteSuggestionCount: number; - REMOVED (handled by search system)
  // excludedFolders: string[]; - REMOVED (follows main qaExclusions setting)
}
```

### 3.3 Settings Tab UI Design

Since most settings have been consolidated, the Projects+ settings section is minimal:

```
┌─────────────────────────────────────────────────────────────────┐
│  Projects+                                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Projects Folder                                                 │
│  Folder where project data is stored.                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ copilot/projects                                            ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  ℹ️ Note: Projects+ uses the same inclusion/exclusion           │
│     settings as QA Mode for note suggestions.                   │
│     Configure them in the "QA" settings tab.                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 ProjectsPlusSettings Component Implementation

```typescript
// src/settings/v2/components/ProjectsPlusSettings.tsx

import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting, useSettingsValue } from "@/settings/model";
import React from "react";

export const ProjectsPlusSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <div className="tw-space-y-4">
      <section>
        <div className="tw-mb-3 tw-text-xl tw-font-bold">Projects+</div>
        <div className="tw-space-y-4">
          {/* Projects Folder */}
          <SettingItem
            type="text"
            title="Projects Folder"
            description="Folder where project data is stored. Each project creates a subfolder here."
            value={settings.projectsPlusFolder}
            onChange={(value) => updateSetting("projectsPlusFolder", value)}
            placeholder="copilot/projects"
          />

          {/* Info about shared settings */}
          <div className="tw-rounded tw-bg-secondary tw-p-3 tw-text-sm tw-text-muted">
            <p>
              <strong>Note:</strong> Projects+ uses the same inclusion/exclusion settings as QA Mode
              for note suggestions. Configure them in the <strong>QA</strong> settings tab.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
```

### 3.5 Integrating into Settings

**Option A: Add to CopilotPlusSettings.tsx**

Since Projects+ is a Plus feature, add it to the existing Plus settings tab:

```typescript
// In CopilotPlusSettings.tsx, add:
import { ProjectsPlusSettings } from "./ProjectsPlusSettings";

// In the component render:
<ProjectsPlusSettings />
```

**Option B: Add to AdvancedSettings.tsx**

Alternatively, add to Advanced settings as a separate section.

### 3.6 Note Suggestion Configuration

**Key Design Decision:** Note suggestions follow the main QA inclusion/exclusion settings.

The `NoteAssignmentService` should use `qaExclusions` and `qaInclusions` from the main settings:

```typescript
// In NoteAssignmentService.ts
import { getSettings } from "@/settings/model";

class NoteAssignmentService {
  async suggestNotes(projectDescription: string, options?: NoteAssignmentOptions) {
    const settings = getSettings();

    // Apply the same exclusions as QA mode
    const exclusions = settings.qaExclusions;
    const inclusions = settings.qaInclusions;

    // ... use these for filtering note suggestions
  }
}
```

---

## 4. Implementation Details

### 4.1 Naming Convention Update

**Important:** The original design document (`projects-plus-technical-design.md`) uses "Goal" terminology (e.g., `GoalStatusBadge.tsx`, `GoalCompletion.tsx`). However, the actual implementation uses "Project" terminology throughout. This phase should continue using "Project" naming:

| Original Design Name  | Actual Implementation Name                            |
| --------------------- | ----------------------------------------------------- |
| `GoalStatusBadge.tsx` | `ProjectStatusBadge.tsx`                              |
| `GoalCompletion.tsx`  | `ProjectStatusDialog.tsx` (already exists)            |
| `ArchivedGoals.tsx`   | Not needed (handled by filter in `ProjectsPanel.tsx`) |

### 4.2 Files to Create

| File                                                  | Purpose                         |
| ----------------------------------------------------- | ------------------------------- |
| `src/settings/v2/components/ProjectsPlusSettings.tsx` | Settings tab component          |
| `src/components/projects-plus/ProjectStatusBadge.tsx` | Reusable status badge component |

### 4.3 Files to Modify

| File                                                 | Changes                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `src/settings/model.ts`                              | Remove `projectsPlusEnabled` from `CopilotSettings` interface |
| `src/constants.ts`                                   | Remove `projectsPlusEnabled` from `DEFAULT_SETTINGS`          |
| `src/main.ts`                                        | Remove any conditional checks for `projectsPlusEnabled`       |
| `src/settings/v2/components/CopilotPlusSettings.tsx` | Import and render `ProjectsPlusSettings`                      |
| `src/core/projects-plus/NoteAssignmentService.ts`    | Use `qaExclusions`/`qaInclusions` for filtering               |
| `src/components/projects-plus/ProjectDetail.tsx`     | Replace inline badge with `ProjectStatusBadge` component      |
| `src/components/projects-plus/ProjectCard.tsx`       | Replace inline badge with `ProjectStatusBadge` component      |

### 4.4 Conversation Auto-Save Behavior

Conversations are auto-saved per message exchange. This is NOT configurable - it's always enabled.

The save happens in `ConversationPersistence.ts`:

```typescript
// After each message exchange:
await conversationPersistence.saveConversation(project, conversation);
```

### 4.5 Model Configuration for Discuss

The Discuss feature uses the default chat model (`defaultModelKey`) rather than a separate model setting. This simplifies configuration and ensures consistency.

---

## 5. Edge Cases & Error Handling

### 5.1 Completion Edge Cases

| Scenario                           | Handling                                                     |
| ---------------------------------- | ------------------------------------------------------------ |
| **Empty reflection**               | Allow completion - reflection is optional                    |
| **Very long reflection**           | No limit, but consider adding a soft warning for >1000 chars |
| **Completion fails**               | Show error notice, keep dialog open                          |
| **Project already completed**      | Button should not be visible; if API called, return silently |
| **Concurrent completion attempts** | Use loading state to prevent double-submission               |

### 5.2 Settings Edge Cases

| Scenario                               | Handling                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| **Invalid folder path**                | Validate path, show error if contains illegal characters |
| **Folder doesn't exist**               | Create folder on first project creation, not on save     |
| **Empty folder path**                  | Fall back to default `copilot/projects`                  |
| **Path with leading/trailing slashes** | Normalize path on save                                   |

### 5.3 Filter Edge Cases

| Scenario                                      | Handling                                                    |
| --------------------------------------------- | ----------------------------------------------------------- |
| **Filter shows no results**                   | Show empty state with helpful message                       |
| **Search + filter combination**               | Apply both filters, show combined empty state if no results |
| **Project status changes while viewing list** | Reactive update via subscription                            |

### 5.4 Archived Goal View Edge Cases

| Scenario                                     | Handling                                           |
| -------------------------------------------- | -------------------------------------------------- |
| **Viewing archived goal with deleted notes** | Show warning icon next to missing notes            |
| **Attempting to discuss archived goal**      | "Discuss" button hidden for archived status        |
| **Reactivating a goal**                      | Status changes to "active", all actions re-enabled |

---

## 6. Testing Checklist

### 6.1 Goal Completion Flow

- [ ] Click "Complete" from ProjectDetail footer opens dialog
- [ ] Journey summary shows correct days, notes, conversations counts
- [ ] Empty reflection is accepted
- [ ] Reflection with text is saved to project
- [ ] Cancel closes dialog without changes
- [ ] Completing updates project status to "completed"
- [ ] Completed project shows in list when filter is "All" or "Completed"
- [ ] Completed project does NOT appear when filter is "Active"
- [ ] `goal.md` file contains `status: "completed"` and `completedAt` timestamp
- [ ] `goal.md` file contains reflection text

### 6.2 Archived Goals View

- [ ] Archived projects appear in list when filter is "All" or "Archived"
- [ ] Archived project detail shows "Archived" badge
- [ ] "Add Notes" and "Suggest" buttons hidden for archived projects
- [ ] Footer shows only "Edit" and "Reactivate" for archived projects
- [ ] Reactivating changes status back to "active"
- [ ] All actions re-enabled after reactivation

### 6.3 Settings Tab

- [ ] Projects+ settings appear in Plus/Advanced tab
- [ ] Folder path input accepts valid paths
- [ ] Info message about shared QA settings is visible
- [ ] Settings persist after Obsidian reload
- [ ] Changing folder path affects new project creation

### 6.4 Note Suggestions with Exclusions

- [ ] Notes in excluded folders (from QA settings) don't appear in suggestions
- [ ] Notes matching inclusion patterns appear in suggestions
- [ ] Exclusions take precedence over inclusions
- [ ] Suggestions work correctly with empty exclusions/inclusions

### 6.5 Persistence

- [ ] Create project, complete it, reload Obsidian - project still completed
- [ ] Reflection text persists after reload
- [ ] Settings persist after reload
- [ ] Projects folder setting affects file storage location

---

## Appendix A: ProjectStatusBadge Styles Reference

```typescript
// Current implementation in utils.ts (used by ProjectStatusBadge)
export function getStatusBadgeStyles(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "tw-bg-modifier-success-rgb/20 tw-text-success";
    case "completed":
      return "tw-bg-blue-rgb/20 tw-text-context-manager-blue";
    case "archived":
      return "tw-bg-modifier-hover tw-text-muted";
    default:
      return "";
  }
}
```

## Appendix B: Default Settings Values

```typescript
// From constants.ts
export const DEFAULT_PROJECTS_FOLDER = "copilot/projects";

// From DEFAULT_SETTINGS
projectsPlusFolder: DEFAULT_PROJECTS_FOLDER,

// Note: projectsPlusEnabled has been removed - feature is always enabled
```

## Appendix C: Removed Settings Rationale

| Removed Setting       | Reason                                                |
| --------------------- | ----------------------------------------------------- |
| `projectsPlusEnabled` | Feature is always enabled, no toggle needed           |
| `showCompletedInList` | Filter dropdown provides this functionality directly  |
| `noteSuggestionCount` | Handled by search system, no user-facing limit needed |
| `excludedFolders`     | Consolidated with main `qaExclusions` setting         |
| `autoSaveEnabled`     | Always enabled per design decision                    |
| `defaultDiscussModel` | Uses main `defaultModelKey` for consistency           |

This consolidation reduces settings complexity and ensures consistent behavior across the plugin.
