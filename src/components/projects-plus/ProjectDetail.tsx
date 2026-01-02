import CopilotPlugin from "@/main";
import { NoteSuggestion, Project, UpdateProjectInput } from "@/types/projects-plus";
import { TFile } from "obsidian";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Check,
  Archive,
  RotateCcw,
  Edit,
  FileText,
  MessageSquare,
  Plus,
  Sparkles,
  X,
} from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AddNoteModal } from "@/components/modals/AddNoteModal";
import { ProjectEditDialog } from "./ProjectEditDialog";
import { NoteSuggestionsDialog } from "./NoteSuggestionsDialog";
import { ProjectStatusDialog, StatusAction } from "./ProjectStatusDialog";
import {
  getStatusBadgeStyles,
  formatRelativeTime,
  formatDate,
  calculateJourneySummary,
} from "./utils";

interface ProjectDetailProps {
  projectId: string;
  plugin: CopilotPlugin;
  onBack: () => void;
}

/**
 * ProjectDetail - Full project detail view displayed in the side panel
 */
export function ProjectDetail({ projectId, plugin, onBack }: ProjectDetailProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [suggestDialogOpen, setSuggestDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [statusAction, setStatusAction] = useState<StatusAction>("complete");

  // Subscribe to ProjectManager for real-time updates
  useEffect(() => {
    const loadProject = () => {
      const updated = plugin.projectsPlusManager.getProject(projectId);
      if (updated) {
        setProject(updated);
      } else {
        // Project was deleted externally
        onBack();
      }
    };

    // Initial load
    loadProject();

    // Subscribe to changes
    const unsubscribe = plugin.projectsPlusManager.subscribe(loadProject);
    return unsubscribe;
  }, [plugin.projectsPlusManager, projectId, onBack]);

  const handleSaveProject = useCallback(
    async (updates: UpdateProjectInput) => {
      await plugin.projectsPlusManager.updateProject(projectId, updates);
    },
    [plugin.projectsPlusManager, projectId]
  );

  const handleAddNotes = useCallback(
    async (_projectId: string, suggestions: NoteSuggestion[]) => {
      const relevanceScores = new Map(suggestions.map((s) => [s.path, s.relevanceScore]));
      await plugin.projectsPlusManager.addNotesToProject(
        projectId,
        suggestions.map((s) => s.path),
        relevanceScores
      );
    },
    [plugin.projectsPlusManager, projectId]
  );

  const handleAddNote = useCallback(
    async (notePath: string) => {
      await plugin.projectsPlusManager.addNoteToProject(projectId, notePath, true);
    },
    [plugin.projectsPlusManager, projectId]
  );

  const handleRemoveNote = useCallback(
    async (notePath: string) => {
      await plugin.projectsPlusManager.removeNoteFromProject(projectId, notePath);
    },
    [plugin.projectsPlusManager, projectId]
  );

  const handleOpenNote = useCallback(
    (path: string) => {
      plugin.app.workspace.openLinkText(path, "");
    },
    [plugin.app.workspace]
  );

  const handleOpenAddNoteModal = useCallback(() => {
    if (!project) return;
    const excludePaths = project.notes.map((n) => n.path);
    const modal = new AddNoteModal({
      app: plugin.app,
      onNoteSelect: handleAddNote,
      excludeNotePaths: excludePaths,
    });
    modal.open();
  }, [plugin.app, project, handleAddNote]);

  const handleStatusAction = useCallback((action: StatusAction) => {
    setStatusAction(action);
    setStatusDialogOpen(true);
  }, []);

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

  /**
   * Check if a note file exists in the vault
   */
  const noteExists = useCallback(
    (path: string): boolean => {
      const file = plugin.app.vault.getAbstractFileByPath(path);
      return file instanceof TFile;
    },
    [plugin.app.vault]
  );

  if (!project) {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center">
        <p className="tw-text-muted">Loading...</p>
      </div>
    );
  }

  const journey = calculateJourneySummary(project);

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      {/* Header */}
      <div className="tw-flex tw-items-center tw-gap-2 tw-border-b tw-border-border tw-p-4">
        <Button variant="ghost2" size="icon" onClick={onBack} className="tw-shrink-0">
          <ArrowLeft className="tw-size-4" />
        </Button>
        <h2 className="tw-flex-1 tw-truncate tw-text-lg tw-font-semibold tw-text-normal">
          {project.title}
        </h2>
        <span
          className={`tw-shrink-0 tw-rounded-sm tw-px-2 tw-py-0.5 tw-text-xs tw-font-medium tw-capitalize ${getStatusBadgeStyles(project.status)}`}
        >
          {project.status}
        </span>
      </div>

      {/* Scrollable content */}
      <div className="tw-flex-1 tw-overflow-y-auto tw-p-4">
        {/* Description */}
        {project.description && (
          <div className="tw-mb-4">
            <p className="tw-whitespace-pre-wrap tw-text-sm tw-text-normal">
              {project.description}
            </p>
          </div>
        )}

        {/* Deadline */}
        {project.deadline && (
          <div className="tw-mb-4 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-muted">
            <Calendar className="tw-size-4" />
            <span>Deadline: {formatDate(project.deadline)}</span>
          </div>
        )}

        {/* Success Criteria */}
        {project.successCriteria.length > 0 && (
          <div className="tw-mb-4">
            <h3 className="tw-mb-2 tw-text-sm tw-font-medium tw-text-normal">Success Criteria</h3>
            <ul className="tw-space-y-1">
              {project.successCriteria.map((criterion, index) => (
                <li
                  key={index}
                  className="tw-flex tw-items-start tw-gap-2 tw-text-sm tw-text-muted"
                >
                  <span className="tw-select-none">•</span>
                  <span>{criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Stats bar */}
        <div className="tw-mb-4 tw-flex tw-items-center tw-gap-4 tw-rounded tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs tw-text-muted">
          <span className="tw-flex tw-items-center tw-gap-1">
            <FileText className="tw-size-3" />
            {journey.notesCount} {journey.notesCount === 1 ? "note" : "notes"}
          </span>
          <span className="tw-flex tw-items-center tw-gap-1">
            <MessageSquare className="tw-size-3" />
            {journey.conversationsCount}{" "}
            {journey.conversationsCount === 1 ? "conversation" : "conversations"}
          </span>
          <span>
            {journey.daysActive} {journey.daysActive === 1 ? "day" : "days"} active
          </span>
        </div>

        {/* Notes section */}
        <div className="tw-mb-4">
          <div className="tw-mb-2 tw-flex tw-items-center tw-justify-between">
            <h3 className="tw-text-sm tw-font-medium tw-text-normal">Notes</h3>
            {project.status === "active" && (
              <div className="tw-flex tw-gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSuggestDialogOpen(true)}
                  className="tw-flex tw-items-center tw-gap-1"
                >
                  <Sparkles className="tw-size-3" />
                  Suggest
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenAddNoteModal}
                  className="tw-flex tw-items-center tw-gap-1"
                >
                  <Plus className="tw-size-3" />
                  Add
                </Button>
              </div>
            )}
          </div>

          {project.notes.length === 0 ? (
            <div className="tw-rounded tw-border tw-border-dashed tw-border-border tw-py-6 tw-text-center tw-text-sm tw-text-muted">
              No notes assigned yet
            </div>
          ) : (
            <div className="tw-space-y-1">
              {project.notes.map((note) => {
                const exists = noteExists(note.path);
                const fileName = note.path.split("/").pop() ?? note.path;

                return (
                  <div
                    key={note.path}
                    className="tw-group tw-flex tw-items-center tw-gap-2 tw-rounded tw-border tw-border-border tw-px-3 tw-py-2"
                  >
                    <FileText className="tw-size-4 tw-shrink-0 tw-text-muted" />
                    <button
                      onClick={() => exists && handleOpenNote(note.path)}
                      disabled={!exists}
                      className={`tw-flex-1 tw-truncate tw-text-left tw-text-sm ${
                        exists
                          ? "tw-text-normal hover:tw-text-accent hover:tw-underline"
                          : "tw-text-muted"
                      }`}
                    >
                      {fileName}
                    </button>
                    {!exists && (
                      <span title="File not found">
                        <AlertTriangle className="tw-size-4 tw-shrink-0 tw-text-warning" />
                      </span>
                    )}
                    {note.manuallyAdded && (
                      <span className="tw-shrink-0 tw-text-xs tw-text-faint">manual</span>
                    )}
                    {project.status === "active" && (
                      <Button
                        variant="ghost2"
                        size="icon"
                        onClick={() => handleRemoveNote(note.path)}
                        className="tw-shrink-0 tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100"
                      >
                        <X className="tw-size-3" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Conversations section (Phase 5 placeholder) */}
        <div className="tw-mb-4">
          <h3 className="tw-mb-2 tw-text-sm tw-font-medium tw-text-normal">Conversations</h3>
          <div className="tw-rounded tw-border tw-border-dashed tw-border-border tw-py-6 tw-text-center tw-text-sm tw-text-muted">
            Coming in Phase 5...
          </div>
        </div>

        {/* Reflection (if completed) */}
        {project.status === "completed" && project.reflection && (
          <div className="tw-mb-4">
            <h3 className="tw-mb-2 tw-text-sm tw-font-medium tw-text-normal">Reflection</h3>
            <div className="tw-rounded tw-bg-secondary tw-p-3 tw-text-sm tw-text-normal">
              {project.reflection}
            </div>
          </div>
        )}

        {/* Updated timestamp */}
        <div className="tw-text-xs tw-text-faint">
          Updated {formatRelativeTime(project.updatedAt)}
        </div>
      </div>

      {/* Footer actions */}
      <div className="tw-flex tw-items-center tw-justify-between tw-border-t tw-border-border tw-p-4">
        <Button variant="secondary" onClick={() => setEditDialogOpen(true)}>
          <Edit className="tw-mr-2 tw-size-4" />
          Edit
        </Button>
        <div className="tw-flex tw-gap-2">
          {project.status === "active" && (
            <>
              <Button variant="secondary" onClick={() => handleStatusAction("archive")}>
                <Archive className="tw-mr-2 tw-size-4" />
                Archive
              </Button>
              <Button onClick={() => handleStatusAction("complete")}>
                <Check className="tw-mr-2 tw-size-4" />
                Complete
              </Button>
            </>
          )}
          {project.status === "completed" && (
            <>
              <Button variant="secondary" onClick={() => handleStatusAction("archive")}>
                <Archive className="tw-mr-2 tw-size-4" />
                Archive
              </Button>
              <Button variant="secondary" onClick={() => handleStatusAction("reactivate")}>
                <RotateCcw className="tw-mr-2 tw-size-4" />
                Reactivate
              </Button>
            </>
          )}
          {project.status === "archived" && (
            <Button onClick={() => handleStatusAction("reactivate")}>
              <RotateCcw className="tw-mr-2 tw-size-4" />
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <ProjectEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        project={project}
        onSave={handleSaveProject}
      />

      <NoteSuggestionsDialog
        open={suggestDialogOpen}
        onOpenChange={setSuggestDialogOpen}
        project={project}
        noteAssignmentService={plugin.noteAssignmentService}
        onAddNotes={handleAddNotes}
        onOpenNote={handleOpenNote}
      />

      <ProjectStatusDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        project={project}
        action={statusAction}
        onConfirm={handleConfirmStatus}
      />
    </div>
  );
}
