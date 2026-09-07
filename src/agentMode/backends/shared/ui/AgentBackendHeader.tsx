import React from "react";
import type {
  BackendDescriptor,
  InstallState,
  ManagedInstallActionState,
} from "@/agentMode/session/types";
import { InstallBadge } from "@/agentMode/backends/shared/installStatus";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TruncatedText } from "@/components/TruncatedText";

export interface AgentBackendHeaderProps {
  displayName: string;
  Icon: BackendDescriptor["Icon"];
  installState: InstallState;
  managedInstall: ManagedInstallActionState;
  canUpdate: boolean;
  resolvedPath: string | null;
  inlineInstall?: React.ReactNode;
  onUpdate: () => void;
  onConfigure: () => void;
}

export function AgentBackendHeader({
  displayName,
  Icon,
  installState,
  managedInstall,
  canUpdate,
  resolvedPath,
  inlineInstall,
  onUpdate,
  onConfigure,
}: AgentBackendHeaderProps) {
  const updating = managedInstall.kind === "running";
  const updateFailed = managedInstall.kind === "error";
  return (
    <div className="tw-flex tw-flex-col tw-gap-2 tw-py-4">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <Icon className="tw-size-4 tw-shrink-0" />
          <div className="tw-flex tw-min-w-0 tw-flex-col">
            <div className="tw-flex tw-items-center tw-gap-2">
              <span className="tw-text-base tw-font-semibold">{displayName}</span>
              <InstallBadge state={installState} />
              {inlineInstall && (
                <Badge variant="accent" className="tw-font-normal">
                  Recommended
                </Badge>
              )}
            </div>
            {resolvedPath && (
              <TruncatedText className="tw-max-w-[90%] tw-font-mono tw-text-xs tw-text-muted">
                {resolvedPath}
              </TruncatedText>
            )}
            {inlineInstall && (
              <span className="tw-text-xs tw-text-muted">Not installed — one download away.</span>
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
        {inlineInstall ? (
          inlineInstall
        ) : canUpdate ? (
          <Button className="tw-shrink-0" size="default" disabled={updating} onClick={onUpdate}>
            {updating ? "Updating…" : updateFailed ? "Retry" : "Update"}
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
      {inlineInstall && (
        <div className="tw-text-xs tw-text-muted">
          Works with Copilot Plus or your own API keys — add providers on the BYOK tab.
        </div>
      )}
    </div>
  );
}
