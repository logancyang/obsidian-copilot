import type { BackendAuthStatus, InstallState } from "@/agentMode/session/types";
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
 * @param state - The binary readiness state the card needs to communicate.
 * @param authStatus - Account status, null while probing, or omitted when authentication is not required.
 */
export function installBadge(
  state: InstallState,
  authStatus?: BackendAuthStatus | null
): InstallBadgeSpec | null {
  if (state.kind === "ready") {
    return authBadge(authStatus) ?? { label: "Ready", variant: "success", showCheck: true };
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

function authBadge(authStatus: BackendAuthStatus | null | undefined): InstallBadgeSpec | null {
  // An installed CLI still needs an authenticated account before the agent is ready.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/379
  if (authStatus === null) return { label: "Checking sign-in…", variant: "outline" };
  if (authStatus?.signedIn === false) return { label: "Sign in required", variant: "outline" };
  return null;
}

interface ReadinessBadgeProps {
  state: InstallState;
  /** Omitted for backends without account authentication; null while the account probe runs. */
  authStatus?: BackendAuthStatus | null;
}

/**
 * Status vocabulary for the Configure dialogs. It differs from {@link installBadge}
 * on the two states where a dialog and a settings card have different jobs: a
 * dialog is the place you go to fix things, so `absent` says so outright instead
 * of staying silent, and `incompatible` names the remedy ("Upgrade required")
 * rather than the diagnosis.
 */
const CONFIG_STATUS_BADGES: Record<InstallState["kind"], InstallBadgeSpec> = {
  ready: { label: "Ready", variant: "success", showCheck: true },
  absent: { label: "Not set up", variant: "outline" },
  incompatible: { label: "Upgrade required", variant: "destructive", showAlert: true },
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
export const InstallBadge: React.FC<ReadinessBadgeProps> = ({ state, authStatus }) => {
  const spec = installBadge(state, authStatus);
  if (!spec) return null;
  return <StatusBadge spec={spec} />;
};

/**
 * Configure-dialog status badge, sat beside the dialog title. Always renders:
 * inside a setup dialog every state — including "not set up" — is information
 * the user came for.
 */
export const ConfigStatusBadge: React.FC<ReadinessBadgeProps> = ({ state, authStatus }) => (
  <StatusBadge
    spec={(state.kind === "ready" && authBadge(authStatus)) || CONFIG_STATUS_BADGES[state.kind]}
  />
);
