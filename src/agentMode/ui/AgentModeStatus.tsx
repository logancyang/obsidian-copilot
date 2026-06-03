import { Button } from "@/components/ui/button";
import {
  useBackendAuthState,
  useBackendInstallState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { useSettingsValue } from "@/settings/model";
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
 * Inline status pill rendered above the chat input in Agent Mode. Only
 * surfaces actionable states: install gap (binary missing) and boot error
 * (Retry). Every healthy state renders nothing — the chat input already
 * conveys readiness.
 */
export const AgentModeStatus: React.FC<Props> = ({ manager, plugin, onInstallClick }) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor);
  const auth = useBackendAuthState(descriptor);
  const settings = useSettingsValue();
  const upgradeInfo = descriptor.getUpgradeInfo?.(settings) ?? null;
  const [upgrading, setUpgrading] = React.useState(false);

  // Re-render on manager notify so `lastError` flips are picked up.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  const handleUpgrade = React.useCallback(() => {
    if (!descriptor.upgrade || upgrading) return;
    setUpgrading(true);
    new Notice(`Upgrading ${descriptor.displayName}…`);
    descriptor
      .upgrade(plugin)
      .then(() => new Notice(`${descriptor.displayName} upgraded.`))
      .catch((e) => {
        logError("[AgentMode] upgrade failed", e);
        new Notice(`Failed to upgrade ${descriptor.displayName}. See console for details.`);
      })
      .finally(() => setUpgrading(false));
  }, [descriptor, plugin, upgrading]);

  if (installState.kind === "absent") {
    return (
      <div className="tw-flex tw-items-center tw-justify-between tw-rounded tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs">
        <span className="tw-text-muted">{descriptor.displayName} not installed</span>
        <Button variant="default" size="sm" onClick={onInstallClick}>
          Install {descriptor.displayName}
        </Button>
      </div>
    );
  }

  // An outdated binary can't drive the model picker (opencode < 1.15.13 lost the
  // model API), so prompt an upgrade before auth or anything else.
  if (upgradeInfo) {
    return (
      <div
        className={cn(
          "tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded",
          "tw-bg-callout-warning/20 tw-px-3 tw-py-2 tw-text-xs tw-text-warning"
        )}
        role="alert"
      >
        <span>
          {descriptor.displayName} {upgradeInfo.currentVersion} is out of date — update to{" "}
          {upgradeInfo.minVersion}+ to choose models.
        </span>
        <Button variant="default" size="sm" disabled={upgrading} onClick={handleUpgrade}>
          {upgrading ? "Upgrading…" : "Upgrade"}
        </Button>
      </div>
    );
  }

  // Installed but the CLI isn't signed in: surface a recoverable Sign-in CTA
  // instead of letting a sent chat fail silently. While signing in, the CLI
  // opens the browser itself; we show its printed URL as a clickable fallback.
  if (descriptor.auth && auth.status && !auth.status.signedIn) {
    return (
      <div className="tw-flex tw-items-center tw-justify-between tw-rounded tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs">
        {auth.signingIn ? (
          <>
            <span className="tw-text-muted">Signing in to {descriptor.displayName}…</span>
            {auth.url && (
              <a href={auth.url} target="_blank" rel="noopener noreferrer">
                Open sign-in page
              </a>
            )}
          </>
        ) : (
          <>
            <span className="tw-text-muted">{descriptor.displayName} not signed in</span>
            <Button variant="default" size="sm" onClick={auth.signIn}>
              Sign in to {descriptor.displayName}
            </Button>
          </>
        )}
      </div>
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
    <div className="tw-flex tw-items-center tw-justify-between tw-rounded tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs">
      <span className="tw-text-error">Error — click Retry</span>
      <Button variant="ghost" size="sm" onClick={handleRetry}>
        Retry
      </Button>
    </div>
  );
};
