import { Button } from "@/components/ui/button";
import React from "react";

interface ConfigDialogShellProps {
  /** One-line current-state summary rendered at the top (e.g. <InstallStatusLine/>). */
  status: React.ReactNode;
  /** Ordered body sections — compose <ConfigSection> children. */
  children: React.ReactNode;
  /** Footer-right content. Defaults to a single "Done" button. */
  footer?: React.ReactNode;
  onClose: () => void;
}

/**
 * Presentational layout shared by every agent's Configure dialog so the status
 * line, sections, and footer stay visually consistent across the three
 * (intentionally bespoke) bodies. Rendered inside a per-agent `ReactModal`
 * subclass — it is not itself a modal; the modal owns the title chrome.
 */
export const ConfigDialogShell: React.FC<ConfigDialogShellProps> = ({
  status,
  children,
  footer,
  onClose,
}) => (
  <div className="tw-flex tw-flex-col tw-gap-4">
    {status}
    <div className="tw-flex tw-flex-col tw-gap-4">{children}</div>
    <div className="tw-flex tw-justify-end tw-gap-2 tw-border-[0px] tw-border-t tw-border-solid tw-border-border tw-pt-4">
      {footer ?? (
        <Button variant="default" size="default" onClick={onClose}>
          Done
        </Button>
      )}
    </div>
  </div>
);

/**
 * One labeled section inside a {@link ConfigDialogShell}. The optional title
 * renders a subtle header above the body; a hairline divider separates each
 * section from the content above it.
 */
export const ConfigSection: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="tw-flex tw-flex-col tw-gap-2 tw-border-[0px] tw-border-t tw-border-solid tw-border-border tw-pt-4">
    {title && <div className="tw-text-sm tw-font-medium">{title}</div>}
    {children}
  </div>
);
