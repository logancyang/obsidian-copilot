import { ConfigStatusBadge } from "@/agentMode/backends/shared/installStatus";
import type { BackendAuthStatus, InstallState } from "@/agentMode/session/types";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import React from "react";

interface ConfigDialogShellProps {
  title: string;
  state: InstallState;
  authStatus?: BackendAuthStatus | null;
  warning?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}

export const ConfigDialogShell: React.FC<ConfigDialogShellProps> = ({
  title,
  state,
  authStatus,
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
      <ConfigStatusBadge state={state} authStatus={authStatus} />
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
  state: InstallState;
  detail?: string;
  action?: React.ReactNode;
}

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

export const ConfigSection: React.FC<{
  title?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, badge, children }) => (
  <div className="copilot-divider-t tw-flex tw-flex-col tw-gap-2 tw-p-4">
    {title && (
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
        <h4 className="tw-m-0 tw-text-sm tw-font-semibold">{title}</h4>
        {badge}
      </div>
    )}
    {children}
  </div>
);
