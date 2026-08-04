import type { InstallState } from "@/agentMode/session/types";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import React from "react";

interface InstallBadgeSpec {
  label: string;
  variant: "outline" | "destructive" | "success";
  /** Render a leading check glyph (ready state). */
  showCheck?: boolean;
  /** Tooltip text (error message). */
  title?: string;
}

/**
 * Gives agent cards one status vocabulary while leaving the configure action as the missing-install signal.
 * @param state - The backend readiness state the card needs to communicate.
 */
export function installBadge(state: InstallState): InstallBadgeSpec | null {
  if (state.kind === "ready") {
    return { label: "Ready", variant: "success", showCheck: true };
  }
  if (state.kind === "checking") {
    return { label: "Checking…", variant: "outline" };
  }
  if (state.kind === "incompatible") {
    return { label: "Incompatible version", variant: "destructive", title: state.message };
  }
  if (state.kind === "error") {
    return { label: "Error", variant: "destructive", title: state.message };
  }
  // absent → no badge.
  return null;
}

/**
 * Card status badge. Renders nothing when the agent is not configured.
 */
export const InstallBadge: React.FC<{ state: InstallState }> = ({ state }) => {
  const spec = installBadge(state);
  if (!spec) return null;
  return (
    <Badge variant={spec.variant} className="tw-gap-1" title={spec.title}>
      {spec.showCheck && <Check className="tw-size-icon-xs" />}
      {spec.label}
    </Badge>
  );
};

/**
 * Gives configuration dialogs a shared readiness summary so users can understand whether setup action is required.
 * @param state - The backend readiness state the dialog needs to explain.
 * @param detail - Optional runtime context that helps the user identify the configured installation.
 */
export const InstallStatusLine: React.FC<{
  state: InstallState;
  detail?: React.ReactNode;
}> = ({ state, detail }) => (
  <div className="tw-flex tw-flex-col tw-items-start tw-gap-1">
    {state.kind === "absent" ? (
      <span className="tw-text-sm tw-text-muted">Not configured.</span>
    ) : (
      <InstallBadge state={state} />
    )}
    {detail && <div className="tw-break-all tw-font-mono tw-text-xs tw-text-muted">{detail}</div>}
    {(state.kind === "incompatible" || state.kind === "error") && (
      <div className="tw-text-sm tw-text-error">{state.message}</div>
    )}
  </div>
);
