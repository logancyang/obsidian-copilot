import { chatBackendIcon } from "@/agentMode/ui/chatBackendIcon";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { RowActionButton } from "@/agentMode/ui/RecentChatMenu";
import { RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import type { ProjectConfig } from "@/aiParams";
import { ReactModal } from "@/components/modals/ReactModal";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { logError } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { ArchiveRestore } from "lucide-react";
import { App, Notice } from "obsidian";
import React, { useMemo, useState } from "react";

export interface ArchivedActions {
  onUnarchive: (id: string) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onUnarchiveProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
}

export function createProjectArchiveActions(
  app: App,
  manager: AgentSessionManager
): Pick<ArchivedActions, "onUnarchiveProject" | "onOpenProject"> {
  return {
    onUnarchiveProject: async (id) => {
      try {
        await ProjectFileManager.getInstance(app).setProjectArchived(id, false);
      } catch (e) {
        logError("[AgentMode] unarchive project failed", e);
        new Notice("Failed to unarchive project.");
        throw e;
      }
    },
    onOpenProject: async (id) => {
      await manager.enterProject(id);
    },
  };
}

export interface ArchivedChatsListProps extends ArchivedActions {
  items: ChatHistoryItem[];
  projects: ProjectConfig[];
}

interface ArchivedRow {
  key: string;
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  archivedAtMs: number;
  unarchive: () => Promise<void>;
  open: () => Promise<void>;
}

interface ArchivedRowProps {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  archivedAt: number;
  onOpen: () => void;
  onUnarchive: () => void;
}

function ArchivedRow({
  Icon,
  title,
  archivedAt,
  onOpen,
  onUnarchive,
}: ArchivedRowProps): React.ReactElement {
  const archivedDate = new Date(archivedAt);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        className="tw-group tw-flex tw-min-h-9 tw-cursor-pointer tw-items-center tw-gap-2 tw-px-2 tw-py-1.5 hover:tw-bg-modifier-hover"
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted">
          <Icon className="tw-size-4" />
        </span>
        <RecentChatTitle title={title} />
        <span
          className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted"
          title={archivedDate.toLocaleString()}
        >
          {archivedDate.toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </span>
        <div className="tw-shrink-0 tw-opacity-0 focus-within:tw-opacity-100 group-hover:tw-opacity-100">
          <RowActionButton label="Unarchive" onClick={onUnarchive}>
            <ArchiveRestore className="tw-size-3.5" />
          </RowActionButton>
        </div>
      </div>
    </li>
  );
}

export function ArchivedChatsList({
  items,
  projects,
  onUnarchive,
  onOpen,
  onUnarchiveProject,
  onOpenProject,
}: ArchivedChatsListProps): React.ReactElement {
  const [unarchivedKeys, setUnarchivedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo<ArchivedRow[]>(() => {
    const byArchivedAtDesc = (a: ArchivedRow, b: ArchivedRow) => b.archivedAtMs - a.archivedAtMs;
    const projectRows = projects
      .map<ArchivedRow>((project) => ({
        key: `project:${project.id}`,
        title: project.name,
        Icon: ProjectFolderIcon,
        archivedAtMs: project.archivedAt ?? 0,
        unarchive: () => onUnarchiveProject(project.id),
        open: () => onOpenProject(project.id),
      }))
      .sort(byArchivedAtDesc);
    const chatRows = items
      .map<ArchivedRow>((item) => ({
        key: `chat:${item.id}`,
        title: item.title,
        Icon: chatBackendIcon(item),
        archivedAtMs: item.archivedAt ?? item.lastAccessedAt.getTime(),
        unarchive: () => onUnarchive(item.id),
        open: () => onOpen(item.id),
      }))
      .sort(byArchivedAtDesc);
    return [...projectRows, ...chatRows];
  }, [items, projects, onUnarchive, onOpen, onUnarchiveProject, onOpenProject]);
  const visibleRows = rows.filter((row) => !unarchivedKeys.has(row.key));

  const unarchive = async (row: ArchivedRow) => {
    await row.unarchive();
    setUnarchivedKeys((keys) => new Set(keys).add(row.key));
  };

  if (visibleRows.length === 0) {
    return (
      <div className="tw-px-2 tw-py-6 tw-text-center tw-text-ui-small tw-text-muted">
        Nothing archived
      </div>
    );
  }

  return (
    <ul className="tw-m-0 tw-flex tw-max-h-96 tw-list-none tw-flex-col tw-divide-y tw-divide-border tw-overflow-y-auto tw-p-0">
      {visibleRows.map((row) => (
        <ArchivedRow
          key={row.key}
          Icon={row.Icon}
          title={row.title}
          archivedAt={row.archivedAtMs}
          onOpen={() => safeAsyncHandler(row.open)()}
          onUnarchive={() => safeAsyncHandler(unarchive)(row)}
        />
      ))}
    </ul>
  );
}

export class ArchivedChatsModal extends ReactModal {
  constructor(
    app: App,
    private readonly items: ChatHistoryItem[],
    private readonly projects: ProjectConfig[],
    private readonly actions: ArchivedActions
  ) {
    super(app, "Archived");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <ArchivedChatsList
        items={this.items}
        projects={this.projects}
        onUnarchive={this.actions.onUnarchive}
        onUnarchiveProject={this.actions.onUnarchiveProject}
        onOpen={async (id) => {
          close();
          await this.actions.onOpen(id);
        }}
        onOpenProject={async (id) => {
          close();
          await this.actions.onOpenProject(id);
        }}
      />
    );
  }
}
