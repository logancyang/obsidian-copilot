import type { InstallState } from "@/agentMode/session/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import React from "react";

interface InstallBadgeSpec {
  label: string;
  variant: "outline" | "destructive";
  /** Extra text color class layered on the badge. */
  className?: string;
  /** Render a leading check glyph (ready state). */
  showCheck?: boolean;
  /** Tooltip text (error message). */
  title?: string;
}

/**
 * Derive the card status badge from an {@link InstallState}.
 *
 * Returns `null` when the agent is not configured — the *absence* of a badge
 * is the "not configured" signal; the CTA-styled Configure button carries the
 * call to action, so no "Setup required" pill is shown on the card.
 */
export function installBadge(state: InstallState): InstallBadgeSpec | null {
  if (state.kind === "ready") {
    return { label: "Ready", variant: "outline", className: "tw-text-success", showCheck: true };
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
    <Badge variant={spec.variant} className={cn("tw-gap-1", spec.className)} title={spec.title}>
      {spec.showCheck && <Check className="tw-size-icon-xs" />}
      {spec.label}
    </Badge>
  );
};

/**
 * Status line shown at the top of a Configure dialog: the badge plus an
 * optional verbose detail line (resolved path / version) the caller supplies,
 * since {@link InstallState} does not carry the path. Unlike the card, the
 * unconfigured state reads explicitly here ("Not configured") because the
 * dialog is where setup happens.
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
  </div>
);
