import { Button } from "@/components/ui/button";
import {
  useBackendInstallState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import { AgentSessionStatus } from "@/agentMode/session/AgentSession";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendDescriptor } from "@/agentMode/session/types";
import { logError } from "@/logger";
import React from "react";

interface Props {
  /** Plugin's AgentSessionManager. May be undefined on mobile. */
  manager?: AgentSessionManager;
  /** Click handler for the "Install …" CTA when the backend isn't installed. */
  onInstallClick: () => void;
}

/**
 * Inline status pill rendered above the chat input in Agent Mode. Pure
 * observer: it never spawns the backend itself — `AgentModeChat` does that
 * on mount. Surfaces install gaps, boot state, and per-turn status.
 *
 * Backend-agnostic: all backend-specific copy (display name, version) comes
 * from the *active session's* `BackendDescriptor` — that's the backend
 * actually running the conversation, which can differ from the user's
 * default backend after a cross-backend tab switch.
 */
export const AgentModeStatus: React.FC<Props> = ({ manager, onInstallClick }) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor);

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
        <span className="tw-text-muted">{descriptor.displayName} not installed</span>
        <Button variant="default" size="sm" onClick={onInstallClick}>
          Install {descriptor.displayName}
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
        {statusLabel(descriptor, sessionStatus, !!session, !!bootError, booting)}
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
  descriptor: BackendDescriptor,
  status: AgentSessionStatus,
  hasSession: boolean,
  errored: boolean,
  booting: boolean
): string {
  const name = descriptor.displayName;
  if (errored) return `Error — click Retry`;
  if (booting) return `Starting ${name}…`;
  if (!hasSession) return `Initializing ${name}…`;
  switch (status) {
    case "starting":
      return `Starting ${name}…`;
    case "idle":
      return `Ready — ${name}`;
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
