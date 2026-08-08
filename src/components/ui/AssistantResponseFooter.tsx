import React from "react";

export interface AssistantResponseFooterProps {
  /** Metadata anchored to the response's leading edge, such as whole-turn duration. */
  leading?: React.ReactNode;
  /** Creation time shown only when leading metadata is absent. */
  timestamp?: React.ReactNode;
  /** Response controls anchored to the trailing edge. */
  actions?: React.ReactNode;
}

/**
 * Keeps completed assistant metadata and controls in one responsive footer treatment.
 */
export const AssistantResponseFooter: React.FC<AssistantResponseFooterProps> = ({
  leading,
  timestamp,
  actions,
}) => {
  const hasLeading = leading !== undefined && leading !== null && leading !== false;
  const hasTimestamp =
    !hasLeading && timestamp !== undefined && timestamp !== null && timestamp !== false;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  const hasMetadata = hasLeading || hasTimestamp;

  return (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-2">
      {hasMetadata ? (
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2 tw-overflow-hidden">
          {hasLeading ? (
            <div data-response-footer-leading className="tw-shrink-0">
              {leading}
            </div>
          ) : null}
          {hasTimestamp ? (
            <div className="tw-truncate tw-text-xs tw-text-faint">{timestamp}</div>
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
