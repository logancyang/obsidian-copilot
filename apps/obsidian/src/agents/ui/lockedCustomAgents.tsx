import {
  getCustomAgentsGate,
  useCustomAgentsGate,
  type CustomAgentsGate,
} from "@/agents/customAgentsGate";
import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AGENTS_MENTION_CATEGORY } from "@/agents/ui/agentMentionOptions";
import { NewAgentButton } from "@/agents/ui/AgentRoster";
import {
  CustomAgentsUpsellModal,
  type CustomAgentsUpsellMedium,
} from "@/agents/ui/CustomAgentsUpsell";
import { LockedAgentsUpsellModal } from "@/agents/ui/LockedAgentsUpsell";
import { CustomAgentStoreContext, useCustomAgents } from "@/agents/ui/useCustomAgents";
import type { CategoryOption } from "@/components/chat-components/hooks/useAtMentionCategories";
import { useApp } from "@/context";
import { ensureEntitlement } from "@/plusUtils";
import type { App } from "obsidian";
import React, { useContext, useMemo } from "react";

let runningCheck: Promise<void> | null = null;

async function checkLicense(app: App, afterCheck: (unlocked: boolean) => void): Promise<void> {
  const unlocked = await ensureEntitlement(
    app,
    "custom_agents",
    () => getCustomAgentsGate() === "full"
  );
  afterCheck(unlocked);
}

function checkLicenseOnce(app: App, afterCheck: (unlocked: boolean) => void): Promise<void> {
  runningCheck ??= checkLicense(app, afterCheck).finally(() => {
    runningCheck = null;
  });
  return runningCheck;
}

export function openLockedCustomAgents(
  app: App,
  medium: CustomAgentsUpsellMedium,
  agents: readonly CustomAgent[],
  onUnlocked?: () => void
): Promise<void> {
  return checkLicenseOnce(app, (unlocked) => {
    // Only this click's own check opens what was clicked; a key entered later must not pop a dialog over settings.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/1016
    if (unlocked) onUnlocked?.();
    // A vault that already has agents shows them instead of the preview pitch.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/950
    else if (agents.length > 0) new LockedAgentsUpsellModal(app, agents).open();
    else new CustomAgentsUpsellModal(app, medium).open();
  });
}

export function openLockedAgentProfile(app: App, openProfile: () => void): Promise<void> {
  return checkLicenseOnce(app, openProfile);
}

interface LockedNewAgentButtonProps {
  emphasized: boolean;
  onUnlocked: () => void;
}

function LockedNewAgentButton({
  emphasized,
  onUnlocked,
}: LockedNewAgentButtonProps): React.ReactElement {
  const app = useApp();
  const agents = useCustomAgents(useContext(CustomAgentStoreContext));
  return (
    <NewAgentButton
      emphasized={emphasized}
      locked
      onClick={() => void openLockedCustomAgents(app, "custom_agent_dialog", agents, onUnlocked)}
    />
  );
}

export interface NewAgentButtonOptions {
  emphasized: boolean;
  onCreate: () => void;
}

export function renderNewAgentButton(
  gate: CustomAgentsGate,
  { emphasized, onCreate }: NewAgentButtonOptions
): React.ReactElement | undefined {
  if (gate === "full") return <NewAgentButton emphasized={emphasized} onClick={onCreate} />;
  if (gate === "locked") {
    return <LockedNewAgentButton emphasized={emphasized} onUnlocked={onCreate} />;
  }
  return undefined;
}

export interface LockedAgentMention {
  option: CategoryOption;
  agents: readonly CustomAgent[];
  choose: () => void;
}

const LOCKED_AGENTS_MENTION_CATEGORY: CategoryOption = {
  ...AGENTS_MENTION_CATEGORY,
  lockedNote: "Supporter preview",
};

export function useLockedAgentMention(enabled: boolean): LockedAgentMention | null {
  const app = useApp();
  const gate = useCustomAgentsGate();
  const agents = useCustomAgents(useContext(CustomAgentStoreContext));
  return useMemo(
    () =>
      enabled && gate === "locked"
        ? {
            option: LOCKED_AGENTS_MENTION_CATEGORY,
            agents,
            choose: () => void openLockedCustomAgents(app, "custom_agent_mention", agents),
          }
        : null,
    [app, enabled, gate, agents]
  );
}
