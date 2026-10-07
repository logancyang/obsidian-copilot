import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { openReportIssueModal } from "@/agentMode/ui/ReportIssueModal";
import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import {
  useBackendInstallState,
  useManagedInstallActionState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import React from "react";

interface Props {
  manager?: AgentSessionManager;
  plugin: CopilotPlugin;
  onInstallClick: () => void;
}

export const AgentModeStatus: React.FC<Props> = ({ manager, plugin, onInstallClick }) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);

  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  const heldConfigChange = manager?.hasHeldConfigChange(descriptor.id) ?? false;
  // A reload waits for a running turn to finish, so read the queued restart
  // rather than the click: the action then reports progress for exactly as
  // long as the restart is actually outstanding.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
  const reloading = manager?.isBackendRestartPending(descriptor.id) ?? false;

  const handleReload = React.useCallback(() => {
    manager?.applyHeldConfigChange(descriptor.id).catch((e) => {
      logError("[AgentMode] reload after config change failed", e);
    });
  }, [manager, descriptor.id]);

  const handleUpgrade = React.useCallback(() => {
    const action = descriptor.managedInstall;
    if (!action || managedInstall.kind === "running") return;
    new Notice(`Upgrading ${descriptor.displayName}…`);
    action
      .run(plugin)
      .then(() => new Notice(`${descriptor.displayName} upgraded.`))
      .catch((e) => {
        logError("[AgentMode] upgrade failed", e);
        new Notice(`Failed to upgrade ${descriptor.displayName}. See console for details.`);
      });
  }, [descriptor, plugin, managedInstall.kind]);

  if (installState.kind === "absent") {
    return (
      <AgentStatusCard
        message={`${descriptor.displayName} not installed`}
        action={{ label: `Install ${descriptor.displayName}`, onClick: onInstallClick }}
      />
    );
  }

  if (installState.kind === "checking") {
    return <AgentStatusCard message={`Checking ${descriptor.displayName} version…`} />;
  }

  if (installState.kind === "incompatible") {
    const canUpgrade = descriptor.managedInstall !== undefined;
    const upgrading = managedInstall.kind === "running";
    const failed = managedInstall.kind === "error";
    return (
      <AgentStatusCard
        tone={failed ? "error" : "warning"}
        // State supplies the summary; never infer a cause by parsing the backend's full error.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/410
        summary={
          upgrading
            ? `Updating ${descriptor.displayName}…`
            : failed
              ? `${descriptor.displayName} update failed`
              : `${descriptor.displayName} update required`
        }
        message={
          upgrading ? managedInstall.label : failed ? managedInstall.message : installState.message
        }
        action={{
          label: canUpgrade
            ? upgrading
              ? "Upgrading…"
              : failed
                ? "Retry"
                : "Upgrade"
            : `Configure ${descriptor.displayName}`,
          disabled: canUpgrade && upgrading,
          onClick: canUpgrade ? handleUpgrade : () => descriptor.openInstallUI(plugin),
        }}
      />
    );
  }

  if (installState.kind === "error") {
    return (
      <AgentStatusCard
        tone="error"
        summary={`${descriptor.displayName} setup error`}
        message={installState.message}
        action={{
          label: `Configure ${descriptor.displayName}`,
          onClick: () => descriptor.openInstallUI(plugin),
        }}
      />
    );
  }

  if (descriptor.auth && auth.status && !auth.status.signedIn) {
    return (
      <AgentStatusCard
        message={
          auth.signingIn
            ? `Signing in to ${descriptor.displayName}…`
            : `${descriptor.displayName} not signed in`
        }
        action={
          auth.signingIn
            ? auth.url
              ? { label: "Open sign-in page", href: auth.url }
              : undefined
            : { label: "Sign in", onClick: auth.signIn }
        }
      />
    );
  }

  if (!manager) {
    return null;
  }

  const bootError = manager.getLastError();
  if (!bootError) {
    // Settings the running agent was spawned with have changed since. Applying
    // them restarts the backend and replaces this conversation, so the manager
    // holds the restart and the choice of when to take it belongs here. A boot
    // error keeps its recovery action, which also applies any held config.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    if (!heldConfigChange) return null;
    return (
      <AgentStatusCard
        layout="row"
        message={`${descriptor.displayName} config has changed`}
        action={{
          label: reloading ? "Reloading…" : "Reload",
          disabled: reloading,
          onClick: handleReload,
        }}
      />
    );
  }

  const handleRetry = (): void => {
    // A failed session may remain active after startup rejects. Apply corrected
    // settings before retrying so that session cannot mask the new config.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    const retry = heldConfigChange
      ? manager.applyHeldConfigChange(descriptor.id)
      : manager.getOrCreateActiveSession();
    retry.catch((e) => {
      logError("[AgentMode] retry failed", e);
    });
  };

  const handleReportIssue = (): void => {
    openReportIssueModal({
      app: plugin.app,
      activeBackend: descriptor.id,
      pluginVersion: plugin.manifest.version,
      // The card lives in the Agent Mode pane, so no Settings window covers it.
      // https://github.com/Brevilabs/obsidian-copilot-private/issues/663
      dismissSettings: () => undefined,
    });
  };

  return (
    <AgentStatusCard
      tone="error"
      summary={`${descriptor.displayName} session error`}
      message={bootError}
      action={{ label: "Retry", onClick: handleRetry }}
      secondaryAction={{ label: "Report an issue", onClick: handleReportIssue }}
    />
  );
};
