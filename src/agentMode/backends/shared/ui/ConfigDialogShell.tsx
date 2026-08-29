import { ConfigStatusBadge } from "@/agentMode/backends/shared/installStatus";
import type { InstallState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import React from "react";

interface ConfigDialogShellProps {
  /** Dialog heading. Owned here, not by the modal's native title chrome, so it can share a line with the badge. */
  title: string;
  /** Readiness of the agent being configured; rendered as the badge beside the title. */
  state: InstallState;
  /** Blocking-condition strip below the header — compose <ConfigWarningStrip>. */
  warning?: React.ReactNode;
  /** Ordered body sections — compose <ConfigSection> children. */
  children: React.ReactNode;
  /** Footer-right content. Defaults to a single "Done" button. */
  footer?: React.ReactNode;
  onClose: () => void;
}

/**
 * Presentational layout shared by every agent's Configure dialog so the header,
 * sections, and footer stay visually consistent across the three (intentionally
 * bespoke) bodies. Rendered inside a per-agent `ReactModal` subclass — it is not
 * itself a modal, but it does own the title, which is why its subclasses leave
 * Obsidian's native title element empty.
 *
 * Every band owns its own padding so the dividers between them run edge to edge.
 * That only holds inside a host using the shared full-bleed modal frame; without
 * it the frame's own padding insets every divider by a theme-dependent amount.
 */
export const ConfigDialogShell: React.FC<ConfigDialogShellProps> = ({
  title,
  state,
  warning,
  children,
  footer,
  onClose,
}) => (
  <div className="tw-flex tw-flex-col">
    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2 tw-px-4 tw-pb-3 tw-pt-4">
      <h3 className="tw-m-0 tw-text-ui-medium tw-font-semibold tw-leading-tight tw-text-normal">
        {title}
      </h3>
      <ConfigStatusBadge state={state} />
    </div>
    {(state.kind === "incompatible" || state.kind === "error") && warning && (
      <div className="tw-px-4 tw-pb-3">{warning}</div>
    )}
    {children}
    <div className="copilot-divider-t tw-flex tw-justify-end tw-gap-2 tw-bg-secondary tw-px-4 tw-py-3">
      {footer ?? (
        <Button variant="default" size="default" onClick={onClose}>
          Done
        </Button>
      )}
    </div>
  </div>
);

interface ConfigWarningStripProps {
  /** Readiness state; only the states that carry a message are worth a strip. */
  state: InstallState;
  /** Sentence appended after the state's message, telling the user how to clear it. */
  detail?: string;
  /** In-dialog remedy, for agents that can fix themselves without leaving the dialog. */
  action?: React.ReactNode;
}

/**
 * Alert strip for the one thing standing between the user and a working agent.
 * Renders only for the states that carry a message, so callers can hand it the
 * live install state without branching on the kind themselves.
 */
export const ConfigWarningStrip: React.FC<ConfigWarningStripProps> = ({
  state,
  detail,
  action,
}) => {
  if (state.kind !== "incompatible" && state.kind !== "error") return null;
  return (
    <div
      role="alert"
      className="tw-flex tw-items-start tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-bg-callout-warning/20 tw-p-3 tw-text-sm tw-border-warning/40"
    >
      <AlertTriangle aria-hidden className="tw-mt-0.5 tw-size-4 tw-shrink-0 tw-text-warning" />
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-2">
        <p className="tw-my-0 tw-break-words tw-text-normal">
          {detail ? `${state.message} ${detail}` : state.message}
        </p>
        {action}
      </div>
    </div>
  );
};

/**
 * One labeled section inside a {@link ConfigDialogShell}. The optional title
 * renders a subtle header above the body; a hairline divider separates each
 * section from the content above it.
 */
export const ConfigSection: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="copilot-divider-t tw-flex tw-flex-col tw-gap-2 tw-p-4">
    {title && <div className="tw-text-sm tw-font-medium">{title}</div>}
    {children}
  </div>
);
