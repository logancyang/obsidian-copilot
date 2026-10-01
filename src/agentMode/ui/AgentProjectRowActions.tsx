import { ProjectConfig } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { getProjectFolderPath } from "@/projects/projectPaths";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import { FolderSearch, Pencil, Trash2 } from "lucide-react";
import { App, Notice, TFolder } from "obsidian";
import React, { memo } from "react";

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
  onDeleted?: (projectId: string) => void;
}

export const AgentProjectRowActions = memo(
  ({ app, project, onDeleted }: AgentProjectRowActionsProps): React.ReactElement => {
    const handleEdit = () => {
      new AddProjectModal(
        app,
        async (next) => {
          await ProjectFileManager.getInstance(app).updateProject(project.id, next);
        },
        project
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
      <div className="tw-flex tw-items-center tw-gap-1.5">
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
