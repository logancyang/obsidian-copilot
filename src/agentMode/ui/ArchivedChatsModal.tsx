import { backendRegistry } from "@/agentMode/backends/registry";
import { RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import type { ProjectConfig } from "@/aiParams";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { ProjectFolderIcon } from "@/components/ui/ProjectFolderIcon";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { MessageCircle } from "lucide-react";
import { App } from "obsidian";
import React, { useMemo, useState } from "react";

export interface ArchivedActions {
  onUnarchive: (id: string) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
  onUnarchiveProject: (id: string) => Promise<void>;
  onOpenProject: (id: string) => Promise<void>;
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
        Icon: (item.backendId && backendRegistry[item.backendId]?.Icon) || MessageCircle,
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
        <li key={row.key} className="tw-flex tw-min-h-9 tw-items-center tw-gap-2 tw-px-2 tw-py-1.5">
          <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted">
            <row.Icon className="tw-size-4" />
          </span>
          <RecentChatTitle title={row.title} />
          <span
            className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted"
            title={new Date(row.archivedAtMs).toLocaleString()}
          >
            {formatCompactRelativeTime(row.archivedAtMs)}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => safeAsyncHandler(unarchive)(row)}
          >
            Unarchive
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => safeAsyncHandler(row.open)()}
          >
            Open
          </Button>
        </li>
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
