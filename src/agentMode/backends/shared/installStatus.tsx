import type { InstallState } from "@/agentMode/session/types";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check } from "lucide-react";
import React from "react";

interface InstallBadgeSpec {
  label: string;
  variant: "outline" | "destructive" | "success";
  /** Render a leading check glyph (ready state). */
  showCheck?: boolean;
  /** Render a leading alert glyph (the user has to act). */
  showAlert?: boolean;
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
 * Status vocabulary for the Configure dialogs. It differs from {@link installBadge}
 * on the two states where a dialog and a settings card have different jobs: a
 * dialog is the place you go to fix things, so `absent` says so outright instead
 * of staying silent, and `incompatible` names the remedy ("Update required")
 * rather than the diagnosis.
 */
const CONFIG_STATUS_BADGES: Record<InstallState["kind"], InstallBadgeSpec> = {
  ready: { label: "Ready", variant: "success", showCheck: true },
  absent: { label: "Not set up", variant: "outline" },
  incompatible: { label: "Update required", variant: "destructive", showAlert: true },
  checking: { label: "Checking…", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
};

const StatusBadge: React.FC<{ spec: InstallBadgeSpec }> = ({ spec }) => (
  <Badge variant={spec.variant} className="tw-gap-1" title={spec.title}>
    {spec.showCheck && <Check aria-hidden className="tw-size-icon-xs" />}
    {spec.showAlert && <AlertTriangle aria-hidden className="tw-size-icon-xs" />}
    {spec.label}
  </Badge>
);

/**
 * Card status badge. Renders nothing when the agent is not configured.
 */
export const InstallBadge: React.FC<{ state: InstallState }> = ({ state }) => {
  const spec = installBadge(state);
  if (!spec) return null;
  return <StatusBadge spec={spec} />;
};

/**
 * Configure-dialog status badge, sat beside the dialog title. Always renders:
 * inside a setup dialog every state — including "not set up" — is information
 * the user came for.
 */
export const ConfigStatusBadge: React.FC<{ state: InstallState }> = ({ state }) => (
  <StatusBadge spec={CONFIG_STATUS_BADGES[state.kind]} />
);
