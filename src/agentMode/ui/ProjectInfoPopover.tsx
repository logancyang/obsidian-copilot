import { revealProjectFolder } from "@/agentMode/ui/AgentProjectRowActions";
import type { AgentTodoListEntry } from "@/agentMode/session/types";
import { ProjectConfig } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isClaudeImportOnly, openAgentsFile } from "@/instructions/agentsFile";
import { moveProjectPromptToAgentsFile } from "@/projects/moveProjectPrompt";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  FolderSearch,
  List,
  Settings,
} from "lucide-react";
import { App, Notice, TFile, TFolder } from "obsidian";
import React, { memo, useEffect, useState } from "react";

// Files the popover represents with its own fixed row rather than listing as plain project
// files: the metadata record and the instruction file (the AGENTS.md row above). CLAUDE.md is
// handled separately below — hidden only while it is purely Copilot's `@AGENTS.md` wiring,
// listed once the user writes their own rules into it (Claude reads those as live
// instructions, so the file must stay visible).
const HIDDEN_BASENAMES = new Set(["project.md", "agents.md"]);

/** Semantic per-extension badge tints for quickly distinguishing file types. */
const BADGE_CLASSES: Record<string, string> = {
  pdf: "tw-bg-project-red tw-text-project-red",
  md: "tw-bg-project-blue tw-text-project-blue",
  html: "tw-bg-project-orange tw-text-project-orange",
  png: "tw-bg-project-green tw-text-project-green",
};

function FileBadge({ ext }: { ext: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "tw-flex tw-h-4 tw-w-7 tw-shrink-0 tw-items-center tw-justify-center tw-rounded tw-text-smallest tw-font-bold tw-uppercase",
        BADGE_CLASSES[ext] ?? "tw-bg-secondary tw-text-muted"
      )}
    >
      {ext.slice(0, 4) || "file"}
    </span>
  );
}

interface ProgressSectionProps {
  todoList: AgentTodoListEntry[] | null;
}

/**
 * The agent's live execution todo list (`getCurrentTodoList`). Per the design
 * (and matching the backends' own behavior), NO active list renders nothing —
 * the section never placeholder-pads the popover.
 */
function ProgressSection({ todoList }: ProgressSectionProps) {
  if (!todoList || todoList.length === 0) return null;
  const done = todoList.filter((t) => t.status === "completed").length;
  return (
    <div className="tw-px-3 tw-py-2.5">
      <div className="tw-mb-1.5 tw-flex tw-items-baseline tw-justify-between">
        <span className="tw-text-ui-smaller tw-font-semibold tw-text-faint">Progress</span>
        <span className="tw-text-ui-smaller tw-text-faint">
          {done}/{todoList.length}
        </span>
      </div>
      <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0">
        {todoList.map((todo, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- entries are positional and may share content
          <li key={`todo-${i}`} className="tw-flex tw-items-center tw-gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "tw-flex tw-size-5 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-text-xs tw-font-semibold",
                todo.status === "completed"
                  ? "tw-bg-interactive-accent tw-text-on-accent"
                  : todo.status === "in_progress"
                    ? "tw-border-[1.5px] tw-border-solid tw-border-interactive-accent tw-text-accent"
                    : "tw-border-[1.5px] tw-border-solid tw-border-border tw-text-faint"
              )}
            >
              {todo.status === "completed" ? <Check className="tw-size-3" /> : i + 1}
            </span>
            <span
              className={cn(
                "tw-min-w-0 tw-truncate tw-text-ui-small",
                // Done is de-emphasized (faint + strikethrough); everything not
                // yet done — in_progress AND pending — stays full-strength so the
                // contrast reads "completed vs remaining" at a glance.
                todo.status === "completed" ? "tw-text-faint tw-line-through" : "tw-text-normal"
              )}
              title={todo.content}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One listed project file, reduced to what a row draws. */
export interface ProjectFileEntry {
  path: string;
  name: string;
  extension: string;
}

export interface ProjectFilesListProps {
  /** Folder files to list under the fixed AGENTS.md row, already filtered and sorted. */
  files: ProjectFileEntry[];
  onOpenInstructions: () => void;
  onOpenFile: (path: string) => void;
  onReveal: () => void;
}

/**
 * The Project files section as drawn: a fixed AGENTS.md row, the folder's remaining files, and
 * the Outputs placeholder. Presentational on purpose — which files belong here depends on the
 * project record and on reading CLAUDE.md, and that resolution lives in the container below so
 * these rows stay renderable from fixture data.
 */
export function ProjectFilesList({
  files,
  onOpenInstructions,
  onOpenFile,
  onReveal,
}: ProjectFilesListProps) {
  const [outputsOpen, setOutputsOpen] = useState(false);

  return (
    <div className="tw-px-3 tw-py-2.5">
      <div className="tw-mb-1 tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-ui-smaller tw-font-semibold tw-text-faint">Project files</span>
        <Button
          variant="ghost2"
          size="icon"
          aria-label="Reveal project files in vault"
          className="tw-size-5 tw-text-faint hover:tw-text-normal"
          onClick={onReveal}
        >
          <FolderSearch className="tw-size-3.5" />
        </Button>
      </div>

      {/* Fixed first row: the project's canonical instructions file. */}
      <div
        role="button"
        tabIndex={0}
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded tw-p-1 hover:tw-bg-secondary"
        onClick={onOpenInstructions}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpenInstructions();
        }}
      >
        <FileBadge ext="md" />
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small">AGENTS.md</span>
        <ArrowUpRight aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-text-faint" />
      </div>

      {files.map((file) => (
        <div
          key={file.path}
          role="button"
          tabIndex={0}
          className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded tw-p-1 hover:tw-bg-secondary"
          onClick={() => onOpenFile(file.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onOpenFile(file.path);
          }}
        >
          <FileBadge ext={file.extension.toLowerCase()} />
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small" title={file.name}>
            {file.name}
          </span>
        </div>
      ))}

      {/* Outputs: files generated during agent conversations. The producing
          feature hasn't shipped yet, so this is the collapsed empty state the
          design reserves — wired up once outputs land in the project folder. */}
      <div
        role="button"
        tabIndex={0}
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-1 tw-rounded tw-p-1 tw-text-muted hover:tw-bg-secondary"
        onClick={() => setOutputsOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOutputsOpen((v) => !v);
        }}
        aria-expanded={outputsOpen}
      >
        {outputsOpen ? (
          <ChevronDown className="tw-size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="tw-size-3.5" aria-hidden="true" />
        )}
        <span className="tw-text-ui-small tw-font-medium">Outputs</span>
        <span className="tw-text-ui-smaller tw-text-faint">(0)</span>
      </div>
      {outputsOpen && (
        <div className="tw-py-1 tw-pl-6 tw-text-ui-smaller tw-text-faint">No outputs yet</div>
      )}
    </div>
  );
}

interface ProjectFilesSectionProps {
  app: App;
  project: ProjectConfig;
  onClose: () => void;
}

/** Resolves the project folder's listable files and the vault actions the rows trigger. */
function ProjectFilesSection({ app, project, onClose }: ProjectFilesSectionProps) {
  // State rather than a memo: CLAUDE.md's visibility depends on its content (import-only
  // wiring is hidden, user-authored rules are listed), and reading content is async.
  const [files, setFiles] = useState<TFile[]>([]);
  useEffect(() => {
    const record = getCachedProjectRecordById(project.id);
    const folderPath = record
      ? getProjectAnchorFromConfigPath(record.filePath).projectFolderPath
      : null;
    const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
    let cancelled = false;
    void (async () => {
      if (!(folder instanceof TFolder)) {
        if (!cancelled) setFiles([]);
        return;
      }
      const list = folder.children.filter(
        (child): child is TFile =>
          child instanceof TFile &&
          !child.name.startsWith(".") &&
          !HIDDEN_BASENAMES.has(child.name.toLowerCase()) &&
          child.name.toLowerCase() !== "claude.md"
      );
      const claude = folder.children.find(
        (child): child is TFile =>
          child instanceof TFile && child.name.toLowerCase() === "claude.md"
      );
      if (claude) {
        const content = await app.vault.read(claude).catch(() => "");
        if (!isClaudeImportOnly(content)) list.push(claude);
      }
      if (!cancelled) setFiles(list.sort((a, b) => a.name.localeCompare(b.name)));
    })();
    return () => {
      cancelled = true;
    };
  }, [app, project.id]);

  const handleOpenFile = (path: string) => {
    const file = files.find((candidate) => candidate.path === path);
    if (!file) return;
    onClose();
    void app.workspace
      .getLeaf(false)
      .openFile(file)
      .catch((err) => logError("[ProjectInfoPopover] openFile failed", err));
  };

  const handleOpenProjectInstructions = () => {
    const record = getCachedProjectRecordById(project.id);
    if (!record) return;
    onClose();
    // Move any legacy `project.md` text in first, so opening the file shows the user their
    // real instructions rather than a blank page they would have to re-type.
    void moveProjectPromptToAgentsFile(app, record)
      .then(() =>
        openAgentsFile(
          app,
          getProjectAnchorFromConfigPath(record.filePath).projectFolderPath,
          "",
          true
        )
      )
      .catch((error) => {
        logError("[ProjectInfoPopover] Failed to open project AGENTS.md", error);
        new Notice("Failed to open project AGENTS.md.");
      });
  };

  return (
    <ProjectFilesList
      files={files}
      onOpenInstructions={handleOpenProjectInstructions}
      onOpenFile={handleOpenFile}
      onReveal={() => {
        onClose();
        revealProjectFolder(app, project);
      }}
    />
  );
}

interface ProjectInfoPopoverProps {
  app: App;
  project: ProjectConfig;
  /** Live execution todo list of the active session (null = no Progress section). */
  todoList: AgentTodoListEntry[] | null;
  /** Fired after a successful edit via the gear (caller refreshes its cache). */
  onEdited?: (project: ProjectConfig) => void;
  /** Portal container — the AgentHome ROOT (the header sits outside the chat container). */
  container?: HTMLElement | null;
  className?: string;
}

/**
 * Project-info popover anchored to the project header's trailing button,
 * replacing the old `⋯` overflow menu (design: PROJECT_INFO_POPOVER.md,
 * project-info-panel-hifi.html F1–F3). Top card (name + Edit gear + reveal) →
 * Progress (live todo list, hidden when none) → Project files (AGENTS.md
 * row + folder files + Outputs placeholder). Deliberately NO Delete and no
 * config chips — deletion stays on the project list rows' inline actions.
 */
export const ProjectInfoPopover = memo(
  ({ app, project, todoList, onEdited, container, className }: ProjectInfoPopoverProps) => {
    const [open, setOpen] = useState(false);

    const handleEdit = () => {
      setOpen(false);
      // Same agent-flavored edit the old overflow menu opened: full project
      // modal minus the model card + CAG processing status.
      new AddProjectModal(
        app,
        async (next) => {
          try {
            const updated = await ProjectFileManager.getInstance(app).updateProject(
              project.id,
              next
            );
            onEdited?.(updated.project);
          } catch (e) {
            // Reason: log for diagnostics, then rethrow so AddProjectModal keeps the
            // form open and surfaces the failure (duplicate name / folder collision)
            // instead of resolving onSave, closing, and discarding the user's edits.
            // Mirrors the inline edit action in AgentProjectRowActions, which lets
            // updateProject throw into the modal's own error handling.
            logError("[ProjectInfoPopover] updateProject failed", e);
            throw e;
          }
        },
        project,
        undefined,
        true
      ).open();
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            aria-label={`Project info for ${project.name}`}
            className={cn("tw-size-7 tw-text-muted hover:tw-text-normal", className)}
          >
            <List className="tw-size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          container={container}
          className="tw-w-72 tw-p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="tw-flex tw-items-center tw-gap-1 tw-px-3 tw-py-2.5">
            <span
              className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-font-semibold"
              title={project.name}
            >
              {project.name}
            </span>
            <Button
              variant="ghost2"
              size="icon"
              aria-label={`Edit project ${project.name}`}
              className="tw-size-6 tw-text-muted hover:tw-text-normal"
              onClick={handleEdit}
            >
              <Settings className="tw-size-3.5" />
            </Button>
            <Button
              variant="ghost2"
              size="icon"
              aria-label="Reveal project folder in vault"
              className="tw-size-6 tw-text-muted hover:tw-text-normal"
              onClick={() => {
                setOpen(false);
                revealProjectFolder(app, project);
              }}
            >
              <FolderSearch className="tw-size-3.5" />
            </Button>
          </div>
          <ProgressSection todoList={todoList} />
          <ProjectFilesSection app={app} project={project} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    );
  }
);

ProjectInfoPopover.displayName = "ProjectInfoPopover";
