import { backendRegistry } from "@/agentMode/backends/registry";
import { RecentChatTitle } from "@/agentMode/ui/RecentChatTitle";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { formatCompactRelativeTime } from "@/utils/formatRelativeTime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { MessageCircle } from "lucide-react";
import { App } from "obsidian";
import React, { useMemo, useState } from "react";

export interface ArchivedChatActions {
  onUnarchive: (id: string) => Promise<void>;
  onOpen: (id: string) => Promise<void>;
}

export interface ArchivedChatsListProps extends ArchivedChatActions {
  items: ChatHistoryItem[];
}

export function ArchivedChatsList({
  items,
  onUnarchive,
  onOpen,
}: ArchivedChatsListProps): React.ReactElement {
  const [unarchivedIds, setUnarchivedIds] = useState<ReadonlySet<string>>(() => new Set());
  const visibleItems = useMemo(
    () =>
      items
        .filter((item) => !unarchivedIds.has(item.id))
        .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0)),
    [items, unarchivedIds]
  );

  const unarchive = async (id: string) => {
    await onUnarchive(id);
    setUnarchivedIds((ids) => new Set(ids).add(id));
  };

  if (visibleItems.length === 0) {
    return (
      <div className="tw-px-2 tw-py-6 tw-text-center tw-text-ui-small tw-text-muted">
        No archived chats
      </div>
    );
  }

  return (
    <ul className="tw-m-0 tw-flex tw-max-h-96 tw-list-none tw-flex-col tw-divide-y tw-divide-border tw-overflow-y-auto tw-p-0">
      {visibleItems.map((item) => {
        const Icon = (item.backendId && backendRegistry[item.backendId]?.Icon) || MessageCircle;
        const archivedAtMs = item.archivedAt ?? item.lastAccessedAt.getTime();
        return (
          <li
            key={item.id}
            className="tw-flex tw-min-h-9 tw-items-center tw-gap-2 tw-px-2 tw-py-1.5"
          >
            <span className="tw-flex tw-size-6 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-md tw-bg-secondary tw-text-muted">
              <Icon className="tw-size-4" />
            </span>
            <RecentChatTitle title={item.title} />
            <span
              className="tw-shrink-0 tw-whitespace-nowrap tw-text-xs tw-text-muted"
              title={new Date(archivedAtMs).toLocaleString()}
            >
              {formatCompactRelativeTime(archivedAtMs)}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => safeAsyncHandler(unarchive)(item.id)}
            >
              Unarchive
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => safeAsyncHandler(onOpen)(item.id)}
            >
              Open
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export class ArchivedChatsModal extends ReactModal {
  constructor(
    app: App,
    private readonly items: ChatHistoryItem[],
    private readonly actions: ArchivedChatActions
  ) {
    super(app, "Archived");
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <ArchivedChatsList
        items={this.items}
        onUnarchive={this.actions.onUnarchive}
        onOpen={async (id) => {
          close();
          await this.actions.onOpen(id);
        }}
      />
    );
  }
}
