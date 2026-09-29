import type { BackendAuthStatus, InstallState } from "@/agentMode/session/types";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check } from "lucide-react";
import React from "react";

interface InstallBadgeSpec {
  label: string;
  variant: "outline" | "destructive" | "success";
  showCheck?: boolean;
  showAlert?: boolean;
  title?: string;
}

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
  return null;
}

function authBadge(authStatus: BackendAuthStatus | null | undefined): InstallBadgeSpec | null {
  if (authStatus === null) return { label: "Checking sign-in…", variant: "outline" };
  if (authStatus?.signedIn === false) return { label: "Sign in required", variant: "outline" };
  return null;
}

interface ReadinessBadgeProps {
  state: InstallState;
  authStatus?: BackendAuthStatus | null;
}

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

export const InstallBadge: React.FC<ReadinessBadgeProps> = ({ state, authStatus }) => {
  const spec = installBadge(state, authStatus);
  if (!spec) return null;
  return <StatusBadge spec={spec} />;
};

export const ConfigStatusBadge: React.FC<ReadinessBadgeProps> = ({ state, authStatus }) => (
  <StatusBadge
    spec={(state.kind === "ready" && authBadge(authStatus)) || CONFIG_STATUS_BADGES[state.kind]}
  />
);
