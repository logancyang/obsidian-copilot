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
 * Leads users from Agent Mode failures to the relevant recovery action, and from a held
 * configuration change to the reload that applies it, without adding noise to healthy sessions.
 * @param manager - The session manager that exposes startup failures, held config changes, and retry behavior.
 * @param plugin - The plugin instance needed to run backend recovery actions.
 * @param onInstallClick - The action to start setup when the selected backend is absent.
 */
export const AgentModeStatus: React.FC<Props> = ({ manager, plugin, onInstallClick }) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);

  // Re-render on manager notify so `lastError` and held-config flips are picked up.
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
    // Keep progress and failures visible while configuration remains accessible.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/368
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
          // Users choose managed or custom upgrades in configuration, never as a chat side effect.
          // https://github.com/Brevilabs/obsidian-copilot-private/issues/480
          label: `Configure ${descriptor.displayName}`,
          onClick: () => descriptor.openInstallUI(plugin),
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

  return (
    <AgentStatusCard
      tone="error"
      summary={`${descriptor.displayName} session error`}
      message={bootError}
      action={{ label: "Retry", onClick: handleRetry }}
    />
  );
};
