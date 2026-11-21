import { useCustomAgentsGate } from "@/agents/customAgentsGate";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { Button } from "@/components/ui/button";
import { openCopilotSettings } from "@/settings/openSettings";
import { Lock } from "lucide-react";
import type { App } from "obsidian";
import React from "react";

export function unlockCustomAgents(app: App, ownerWindow: Window): void {
  openCopilotSettings(app, ownerWindow, "basic");
}

export interface LockedProfile {
  onUnlock: (ownerWindow: Window) => void;
}

export interface LockedProfileBannerProps extends LockedProfile {
  name: string;
}

const BANNER_CLASS =
  "tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1 tw-border-0 tw-border-b tw-border-solid tw-border-border tw-bg-modifier-hover tw-px-3 tw-py-1.5 tw-text-ui-smaller tw-text-muted";
const BANNER_ACTION_CLASS =
  "clickable-icon tw-h-auto tw-shrink-0 tw-gap-1 tw-bg-transparent tw-p-0 tw-text-ui-smaller tw-text-accent tw-shadow-none";

export function LockedProfileBanner({
  name,
  onUnlock,
}: LockedProfileBannerProps): React.ReactElement {
  return (
    <div className={BANNER_CLASS}>
      <span className="tw-min-w-0 tw-flex-1">{`${name} can't chat without a valid Supporter license.`}</span>
      <button
        type="button"
        onClick={(event) => onUnlock(event.currentTarget.win)}
        className={BANNER_ACTION_CLASS}
      >
        Enter license key
      </button>
    </div>
  );
}

export interface SetupLockedProfile {
  reason: string;
  setUp?: { label: string; open: () => void };
}

export function SetupLockedProfileBanner({
  reason,
  setUp,
}: SetupLockedProfile): React.ReactElement {
  return (
    <div className={BANNER_CLASS}>
      <Lock className="tw-size-3 tw-shrink-0" />
      <span className="tw-min-w-0 tw-flex-1">{reason}</span>
      {setUp && (
        <button type="button" onClick={setUp.open} className={BANNER_ACTION_CLASS}>
          {setUp.label}
        </button>
      )}
    </div>
  );
}

// An agent chat opens read-only while the license isn't valid for custom agents; a turn already running when it stopped being valid finishes first.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/950
// An agent whose model can't run on this device can't reply either, so its old chats open read-only the same way.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/962
export function useReadOnlyChatAgent(
  agent: CustomAgent | null,
  turnInFlight: boolean,
  needsSetup: boolean
): CustomAgent | null {
  const locked = useCustomAgentsGate() === "locked" || needsSetup;
  return locked && !turnInFlight ? agent : null;
}

export interface LockedAgentChatProps {
  name: string;
  onNewChat: () => void;
  onUnlock: (ownerWindow: Window) => void;
  setup?: { reason: string; onOpenProfile: () => void };
}

export function LockedAgentChat({
  name,
  onNewChat,
  onUnlock,
  setup,
}: LockedAgentChatProps): React.ReactElement {
  return (
    <div className="tw-flex tw-w-full tw-flex-col tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-px-3 tw-py-2.5 tw-text-sm tw-text-muted">
      <div className="tw-flex tw-items-start tw-gap-2">
        <Lock className="tw-mt-0.5 tw-size-3.5 tw-shrink-0" />
        <span>
          {setup
            ? `You can read this chat, but ${name} can't reply. ${setup.reason}`
            : `You can read this chat, but ${name} can't reply without a valid Supporter license.`}
        </span>
      </div>
      <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
        <Button variant="ghost" size="sm" onClick={onNewChat}>
          New Copilot chat
        </Button>
        {setup ? (
          <Button size="sm" onClick={setup.onOpenProfile}>
            Open {name}&apos;s profile
          </Button>
        ) : (
          <Button size="sm" onClick={(event) => onUnlock(event.currentTarget.win)}>
            Enter license key
          </Button>
        )}
      </div>
    </div>
  );
}

export function LockedHomeNote({ onUnlock }: LockedProfile): React.ReactElement {
  return (
    <>
      Your teammates need a valid Supporter license to chat.{" "}
      <button
        type="button"
        onClick={(event) => onUnlock(event.currentTarget.win)}
        className="clickable-icon tw-inline-flex tw-h-auto tw-gap-1 tw-bg-transparent tw-p-0 tw-align-baseline tw-text-ui-small tw-text-accent tw-shadow-none"
      >
        Enter license key
      </button>
    </>
  );
}
