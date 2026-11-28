import { formatMessageClock, formatMessageDateTime } from "@/lib/messageTime";
import { cn } from "@/lib/utils";
import { Platform } from "obsidian";
import React from "react";

export interface AssistantResponseFooterProps {
  leading?: React.ReactNode;
  timestampMs?: number;
  actions?: React.ReactNode;
  shownAtRest?: boolean;
}

// A response's row stays in place, dimmed, and its time waits for the pointer or keyboard focus on the response, so no hidden row keeps empty space.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/971
const DIMMED_AT_REST =
  "tw-opacity-50 tw-transition-opacity group-focus-within/response:tw-opacity-100 group-hover/response:tw-opacity-100";
const HIDDEN_AT_REST =
  "tw-opacity-0 tw-transition-opacity group-focus-within/response:tw-opacity-100 group-hover/response:tw-opacity-100";

export const AssistantResponseFooter: React.FC<AssistantResponseFooterProps> = ({
  leading,
  timestampMs,
  actions,
  shownAtRest = false,
}) => {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  const hasTimestamp = !hasLeading && timestampMs !== undefined;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  const hasMetadata = hasLeading || hasTimestamp;
  // A phone has no pointer to hover with, so its rows stay at full strength.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/971
  const rests = !shownAtRest && !Platform.isMobile;

  return (
    <div
      className={cn(
        "tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-2",
        rests && DIMMED_AT_REST
      )}
    >
      {hasMetadata ? (
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-overflow-hidden">
          {hasLeading ? (
            <div data-response-footer-leading className="tw-shrink-0">
              {leading}
            </div>
          ) : null}
          {hasTimestamp ? (
            <div
              className={cn(
                "tw-truncate tw-text-xs tw-tabular-nums tw-text-faint",
                rests && HIDDEN_AT_REST
              )}
              title={formatMessageDateTime(timestampMs)}
            >
              {formatMessageClock(timestampMs)}
            </div>
          ) : null}
        </div>
      ) : null}
      {hasActions ? (
        <div data-response-footer-actions className="tw-ml-auto tw-shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
};
