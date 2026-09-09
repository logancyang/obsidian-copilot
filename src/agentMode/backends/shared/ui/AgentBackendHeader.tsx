import React from "react";
import type {
  BackendDescriptor,
  BackendAuthStatus,
  InstallState,
  ManagedInstallActionState,
} from "@/agentMode/session/types";
import { InstallBadge } from "@/agentMode/backends/shared/installStatus";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/TruncatedText";

export interface AgentBackendHeaderProps {
  displayName: string;
  Icon: BackendDescriptor["Icon"];
  installState: InstallState;
  authStatus?: BackendAuthStatus | null;
  managedInstall: ManagedInstallActionState;
  canUpdate: boolean;
  resolvedPath: string | null;
  onUpdate: () => void;
  onConfigure: () => void;
}

export function AgentBackendHeader({
  displayName,
  Icon,
  installState,
  authStatus,
  managedInstall,
  canUpdate,
  resolvedPath,
  onUpdate,
  onConfigure,
}: AgentBackendHeaderProps) {
  // Shared progress prevents duplicate updates; shared errors keep Retry available across surfaces.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
  const updating = managedInstall.kind === "running";
  const updateFailed = managedInstall.kind === "error";
  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-py-4">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
          <Icon className="tw-size-4 tw-shrink-0" />
          <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col">
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
              <span className="tw-text-base tw-font-semibold">{displayName}</span>
              <InstallBadge state={installState} authStatus={authStatus} />
            </div>
            {resolvedPath && (
              <TruncatedText className="tw-font-mono tw-text-xs tw-text-muted">
                {resolvedPath}
              </TruncatedText>
            )}
            {(installState.kind === "incompatible" || installState.kind === "error") && (
              <span className="tw-text-xs tw-text-error">
                {canUpdate && updating
                  ? managedInstall.label
                  : canUpdate && updateFailed
                    ? managedInstall.message
                    : installState.message}
              </span>
            )}
          </div>
        </div>
        {canUpdate ? (
          <Button className="tw-shrink-0" size="default" disabled={updating} onClick={onUpdate}>
            {updating ? "Upgrading…" : updateFailed ? "Retry" : "Upgrade"}
          </Button>
        ) : (
          <Button
            className="tw-shrink-0"
            size="default"
            variant={installState.kind === "ready" ? "secondary" : "default"}
            onClick={onConfigure}
          >
            Configure
          </Button>
        )}
      </div>
    </div>
  );
}
