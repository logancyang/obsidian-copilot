import { buildChatFileChanges } from "@/agentMode/session/turnFileChanges";
import type { AgentChatMessage, TurnFileChange } from "@/agentMode/session/types";
import { FileChangeCounts } from "@/agentMode/ui/FileChangeSummary";
import {
  FileDetailRow,
  ProjectFilesSection,
  ProjectFilesView,
} from "@/agentMode/ui/ProjectFilesView";
import { ProjectConfig } from "@/aiParams";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { logError } from "@/logger";
import { openFileInTab, type OpenPane } from "@/utils/openVaultPath";
import { List } from "lucide-react";
import { App, TFile } from "obsidian";
import React, { memo, useMemo, useState } from "react";

const CHANGE_LABELS: Record<TurnFileChange["status"], string> = {
  created: "new",
  modified: "edited",
  deleted: "deleted",
};

export interface ProjectInfoPanelProps {
  changes: readonly TurnFileChange[];
  onOpenFile: (path: string, pane: OpenPane) => void;
  children: React.ReactNode;
}

export function ProjectInfoPanel({
  changes,
  onOpenFile,
  children,
}: ProjectInfoPanelProps): React.ReactElement {
  return (
    <>
      <div className="copilot-divider-b">
        <ProjectFilesSection title="Changed in this chat">
          {changes.length === 0 ? (
            <div className="tw-px-1.5 tw-py-1 tw-text-ui-small tw-text-faint">
              No files changed in this chat yet.
            </div>
          ) : (
            changes.map((change) => {
              const folderEnd = change.path.lastIndexOf("/") + 1;
              return (
                <FileDetailRow
                  key={change.path}
                  path={change.path}
                  name={change.path.slice(folderEnd)}
                  folder={change.path.slice(0, folderEnd)}
                  status={CHANGE_LABELS[change.status]}
                  onActivate={(pane) => onOpenFile(change.path, pane)}
                >
                  <FileChangeCounts additions={change.additions} deletions={change.deletions} />
                </FileDetailRow>
              );
            })
          )}
        </ProjectFilesSection>
      </div>
      {children}
    </>
  );
}

interface ProjectInfoContentProps {
  app: App;
  projectId: string;
  messages: readonly AgentChatMessage[];
  onClose: () => void;
}

function ProjectInfoContent({
  app,
  projectId,
  messages,
  onClose,
}: ProjectInfoContentProps): React.ReactElement {
  const changes = useMemo(() => buildChatFileChanges(messages), [messages]);
  const openChangedFile = (path: string, pane: OpenPane): void => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    onClose();
    openFileInTab(app, file, pane).catch((error: unknown) =>
      logError("[ProjectInfoPopover] failed to open the changed file", error)
    );
  };
  return (
    <ProjectInfoPanel changes={changes} onOpenFile={openChangedFile}>
      <ProjectFilesView projectId={projectId} />
    </ProjectInfoPanel>
  );
}

interface ProjectInfoPopoverProps {
  app: App;
  project: ProjectConfig;
  messages: readonly AgentChatMessage[];
  container?: HTMLElement | null;
}

export const ProjectInfoPopover = memo(
  ({ app, project, messages, container }: ProjectInfoPopoverProps) => {
    const [open, setOpen] = useState(false);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            aria-label={`Project info for ${project.name}`}
            className="tw-size-7 tw-text-muted hover:tw-text-normal"
          >
            <List className="tw-size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          container={container}
          collisionBoundary={container}
          collisionPadding={8}
          className="tw-max-h-[var(--radix-popover-content-available-height)] tw-w-80 tw-max-w-[var(--radix-popover-content-available-width)] tw-overflow-y-auto tw-p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ProjectInfoContent
            app={app}
            projectId={project.id}
            messages={messages}
            onClose={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    );
  }
);

ProjectInfoPopover.displayName = "ProjectInfoPopover";
