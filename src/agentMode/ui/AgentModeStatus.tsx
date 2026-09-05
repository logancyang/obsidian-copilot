import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
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
  /** Plugin's AgentSessionManager. May be undefined on mobile. */
  manager?: AgentSessionManager;
  /** The plugin — needed to drive the install/upgrade actions. */
  plugin: CopilotPlugin;
  /** Click handler for the "Install …" CTA when the backend isn't installed. */
  onInstallClick: () => void;
}

/**
 * Leads users from Agent Mode failures to the relevant recovery action without adding noise to healthy sessions.
 * @param manager - The session manager that exposes startup failures and retry behavior.
 * @param plugin - The plugin instance needed to run backend recovery actions.
 * @param onInstallClick - The action to start setup when the selected backend is absent.
 */
export const AgentModeStatus: React.FC<Props> = ({ manager, plugin, onInstallClick }) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);

  // Re-render on manager notify so `lastError` flips are picked up.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

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
        message={
          upgrading
            ? `${managedInstall.label} ${managedInstall.percent}%`
            : failed
              ? managedInstall.message
              : installState.message
        }
        action={{
          label: canUpgrade
            ? upgrading
              ? "Upgrading…"
              : failed
                ? "Retry"
                : "Update"
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
        message={installState.message}
        action={{
          label: `Configure ${descriptor.displayName}`,
          onClick: () => descriptor.openInstallUI(plugin),
        }}
      />
    );
  }

  // Installed but the CLI isn't signed in: surface a recoverable Sign-in CTA
  // instead of letting a sent chat fail silently. While signing in, the CLI
  // opens the browser itself; we show its printed URL as a clickable fallback.
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
            : { label: `Sign in to ${descriptor.displayName}`, onClick: auth.signIn }
        }
      />
    );
  }

  if (!manager) {
    return null;
  }

  const bootError = manager.getLastError();
  if (!bootError) {
    return null;
  }

  const handleRetry = (): void => {
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] retry failed", e);
    });
  };

  return (
    <AgentStatusCard
      tone="error"
      message={bootError}
      action={{ label: "Retry", onClick: handleRetry }}
    />
  );
};
