import { ProjectConfig } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getProjectFolderPath } from "@/projects/projectPaths";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import { FolderSearch, Pencil, Trash2 } from "lucide-react";
import { App, Notice, TFolder } from "obsidian";
import React, { memo } from "react";

/**
 * Reveal a project's folder in Obsidian's file explorer via the internal
 * file-explorer plugin (same approach as the projects migration flow). Hidden
 * (dot-prefixed) folders aren't in the vault cache, so reveal silently no-ops —
 * surface a Notice instead of failing quietly.
 */
export function revealProjectFolder(app: App, project: ProjectConfig): void {
  const record = getCachedProjectRecordById(project.id);
  const folderPath = record ? getProjectFolderPath(record.folderName) : null;
  const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
  if (folder instanceof TFolder) {
    const fileExplorer = (
      app as unknown as {
        internalPlugins?: {
          getPluginById?: (
            id: string
          ) =>
            | { enabled?: boolean; instance?: { revealInFolder?: (folder: TFolder) => void } }
            | undefined;
        };
      }
    ).internalPlugins?.getPluginById?.("file-explorer");
    if (fileExplorer?.enabled && fileExplorer.instance?.revealInFolder) {
      fileExplorer.instance.revealInFolder(folder);
      return;
    }
  }
  new Notice(`Can't reveal "${project.name}" — its folder isn't visible in the file explorer.`);
}

interface AgentProjectRowActionsProps {
  app: App;
  project: ProjectConfig;
  /** Fired after a successful edit (caller refreshes its project list/cache). */
  onEdited?: (project: ProjectConfig) => void;
  /** Fired after a successful delete (caller may exit the scope if it was active). */
  onDeleted?: (projectId: string) => void;
  className?: string;
}

/**
 * Inline action cluster for a project row: Reveal in vault · Edit · Delete.
 * Drop into {@link AgentHomeListRow}'s `trailing` slot — the row reveals it on
 * hover / keyboard focus in the relative time's place, the same way the Recent
 * Chats rows surface their open / rename / delete buttons, so the two shelf tabs
 * read as one component family (this replaces the older `⋯` overflow dropdown).
 *
 * Edit and Delete deliberately stay modal-backed rather than inline: Edit is a
 * multi-field form (the full {@link AddProjectModal}), and Delete keeps the
 * {@link ConfirmModal} whose copy reassures that the notes survive — a destructive
 * project op warrants the heavier confirm than a chat's inline two-step. The
 * persistence ops (`updateProject` / `deleteProject`) run here; the caller wires
 * `onEdited` / `onDeleted` for follow-up (refresh, exit an orphaned scope).
 *
 * Each button stops propagation so reveal / edit / delete never also fires the
 * row's open-project action. The trailing slot already guards this, but keeping
 * it on the buttons leaves the cluster self-contained for reuse outside the row.
 */
export const AgentProjectRowActions = memo(
  ({
    app,
    project,
    onEdited,
    onDeleted,
    className,
  }: AgentProjectRowActionsProps): React.ReactElement => {
    const handleEdit = () => {
      // Agent edit reuses the full project modal MINUS the model card + CAG
      // processing status (agentMode). No `plugin` → no CAG retry affordances.
      new AddProjectModal(
        app,
        async (next) => {
          const updated = await ProjectFileManager.getInstance(app).updateProject(project.id, next);
          onEdited?.(updated.project);
        },
        project,
        undefined,
        true
      ).open();
    };

    const handleDelete = () => {
      new ConfirmModal(
        app,
        async () => {
          try {
            await ProjectFileManager.getInstance(app).deleteProject(project.id);
            onDeleted?.(project.id);
          } catch (e) {
            logError("[AgentProjectRowActions] deleteProject failed", e);
            new Notice(`Failed to delete project "${project.name}".`);
          }
        },
        `Delete project "${project.name}"? This removes its configuration; your notes stay in the vault.`,
        "Delete project",
        "Delete",
        "Cancel"
      ).open();
    };

    return (
      <div className={cn("tw-flex tw-items-center tw-gap-1.5", className)}>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Reveal ${project.name} in vault`}
          title="Reveal in vault"
          className="tw-size-5 tw-p-0"
          onClick={(e) => {
            e.stopPropagation();
            revealProjectFolder(app, project);
          }}
        >
          <FolderSearch className="tw-size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Edit project ${project.name}`}
          title="Edit project"
          className="tw-size-5 tw-p-0"
          onClick={(e) => {
            e.stopPropagation();
            handleEdit();
          }}
        >
          <Pencil className="tw-size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Delete project ${project.name}`}
          title="Delete"
          className="tw-size-5 tw-p-0 tw-text-error hover:tw-text-error"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
        >
          <Trash2 className="tw-size-3.5" />
        </Button>
      </div>
    );
  }
);

AgentProjectRowActions.displayName = "AgentProjectRowActions";
