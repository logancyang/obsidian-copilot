import { Button } from "@/components/ui/button";
import { AgentSessionStatus } from "@/LLMProviders/agentMode/AgentSession";
import { AgentSessionManager } from "@/LLMProviders/agentMode/AgentSessionManager";
import { computeInstallState } from "@/LLMProviders/agentMode/backends/OpencodeBinaryManager";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import React from "react";

interface Props {
  /** Plugin's AgentSessionManager. May be undefined on mobile. */
  manager?: AgentSessionManager;
  /** Click handler for the "Install opencode" CTA when no binary is found. */
  onInstallClick: () => void;
}

/**
 * Inline status pill rendered above the chat input in Agent Mode. Pure
 * observer: it never spawns the backend itself — `AgentChatRouter` does that
 * on chain switch. Surfaces install gaps, boot state, and per-turn status.
 */
export const AgentModeStatus: React.FC<Props> = ({ manager, onInstallClick }) => {
  const settings = useSettingsValue();
  const installState = React.useMemo(
    () => computeInstallState(settings.agentMode),
    [settings.agentMode]
  );

  // Tick on any manager notify (active session set/cleared, isStarting flip,
  // lastError change). We re-read state inline below.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  // Subscribe to per-turn status changes on the active session.
  const session = manager?.getActiveSession() ?? null;
  const [sessionStatus, setSessionStatus] = React.useState<AgentSessionStatus>(
    session?.getStatus() ?? "idle"
  );
  React.useEffect(() => {
    if (!session) {
      setSessionStatus("idle");
      return;
    }
    setSessionStatus(session.getStatus());
    const unsub = session.subscribe({
      onMessagesChanged: () => {},
      onStatusChanged: (s) => setSessionStatus(s),
    });
    return unsub;
  }, [session]);

  if (installState.kind === "absent") {
    return (
      <div className="tw-flex tw-items-center tw-justify-between tw-rounded tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs">
        <span className="tw-text-muted">opencode binary not installed</span>
        <Button variant="default" size="sm" onClick={onInstallClick}>
          Install opencode
        </Button>
      </div>
    );
  }

  if (!manager) {
    return null;
  }

  const booting = manager.getIsStarting();
  const bootError = manager.getLastError();

  const handleRetry = (): void => {
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] retry failed", e);
    });
  };

  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-rounded tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs">
      <span className={statusClassName(sessionStatus, !!bootError, booting)}>
        {statusLabel(sessionStatus, !!session, !!bootError, booting, installState.version)}
      </span>
      {bootError ? (
        <Button variant="ghost" size="sm" onClick={handleRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
};

function statusLabel(
  status: AgentSessionStatus,
  hasSession: boolean,
  errored: boolean,
  booting: boolean,
  version: string
): string {
  if (errored) return `Error — click Retry`;
  if (booting) return `Starting opencode v${version}…`;
  if (!hasSession) return `Initializing opencode v${version}…`;
  switch (status) {
    case "idle":
      return `Ready — opencode v${version}`;
    case "running":
      return "Agent is running…";
    case "awaiting_permission":
      return "Awaiting your permission…";
    case "error":
      return "Error — last turn failed";
    case "closed":
      return "Session closed";
  }
}

function statusClassName(status: AgentSessionStatus, errored: boolean, booting: boolean): string {
  if (errored || status === "error") return "tw-text-error";
  if (booting || status === "running" || status === "awaiting_permission") return "tw-text-loading";
  return "tw-text-muted";
}
