import { navigateToPlusPage } from "@/plusUtils";
import { openCopilotSettings } from "@/settings/openSettings";
import { ExternalLink } from "lucide-react";
import type { App } from "obsidian";
import React from "react";

export function unlockCustomAgents(app: App, lapsed: boolean, ownerWindow: Window): void {
  if (lapsed) navigateToPlusPage("custom_agent_renew");
  else openCopilotSettings(app, ownerWindow, "basic");
}

export function lockedUntil(lapsed: boolean): string {
  return lapsed ? "Locked until you renew" : "Locked until you enter a Supporter license key";
}

export interface LockedProfile {
  lapsed: boolean;
  onUnlock: (ownerWindow: Window) => void;
}

export interface LockedProfileBannerProps extends LockedProfile {
  name: string;
}

export function LockedProfileBanner({
  name,
  lapsed,
  onUnlock,
}: LockedProfileBannerProps): React.ReactElement {
  return (
    <div className="tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1 tw-border-0 tw-border-b tw-border-solid tw-border-border tw-bg-modifier-hover tw-px-3 tw-py-1.5 tw-text-ui-smaller tw-text-muted">
      <span className="tw-min-w-0 tw-flex-1">
        {lapsed
          ? `Your Supporter plan ended. ${name} can't chat until you renew.`
          : `${name} can't chat until you enter a Supporter license key on this device.`}
      </span>
      <button
        type="button"
        onClick={(event) => onUnlock(event.currentTarget.win)}
        className="clickable-icon tw-h-auto tw-shrink-0 tw-gap-1 tw-bg-transparent tw-p-0 tw-text-ui-smaller tw-text-accent tw-shadow-none"
      >
        {lapsed ? "Renew" : "Enter license key"}
        {lapsed && <ExternalLink className="tw-size-3" />}
      </button>
    </div>
  );
}

export function LockedHomeNote({ lapsed, onUnlock }: LockedProfile): React.ReactElement {
  return (
    <>
      {lapsed
        ? "Your Supporter plan ended. Your agents and their files are still here. "
        : "This vault's agents can't chat until you enter a Supporter license key on this device. "}
      <button
        type="button"
        onClick={(event) => onUnlock(event.currentTarget.win)}
        className="clickable-icon tw-inline-flex tw-h-auto tw-gap-1 tw-bg-transparent tw-p-0 tw-align-baseline tw-text-ui-small tw-text-accent tw-shadow-none"
      >
        {lapsed ? "Renew" : "Enter license key"}
        {lapsed && <ExternalLink className="tw-size-3" />}
      </button>
    </>
  );
}
