import {
  getCustomAgentsGate,
  subscribeToCustomAgentsGate,
  type CustomAgentsGate,
} from "@/agents/customAgentsGate";
import { NewAgentButton } from "@/agents/ui/AgentRoster";
import {
  CustomAgentsUpsellModal,
  type CustomAgentsUpsellMedium,
} from "@/agents/ui/CustomAgentsUpsell";
import { useApp } from "@/context";
import { ensureEntitlement } from "@/plusUtils";
import type { App } from "obsidian";
import React from "react";

let runningCheck: Promise<void> | null = null;
let stopWaitingForUnlock: (() => void) | null = null;

function runWhenUnlocked(onUnlocked: () => void): void {
  stopWaitingForUnlock?.();
  const stop = (): void => {
    unsubscribe();
    stopWaitingForUnlock = null;
  };
  const unsubscribe = subscribeToCustomAgentsGate(() => {
    if (getCustomAgentsGate() !== "full") return;
    stop();
    onUnlocked();
  });
  stopWaitingForUnlock = stop;
}

async function checkThenOpenUpsell(
  app: App,
  medium: CustomAgentsUpsellMedium,
  onUnlocked: (() => void) | undefined
): Promise<void> {
  // A user who upgrades after the upsell, or whose check on this click grants the feature, lands in what they clicked.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/582
  if (onUnlocked) runWhenUnlocked(onUnlocked);
  // The check goes out even without a key so the server can count free users' interest.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/582
  const unlocked = await ensureEntitlement(
    app,
    "custom_agents",
    () => getCustomAgentsGate() === "full",
    { sendWithoutKey: true }
  );
  if (!unlocked) new CustomAgentsUpsellModal(app, medium).open();
}

export function openLockedCustomAgents(
  app: App,
  medium: CustomAgentsUpsellMedium,
  onUnlocked?: () => void
): Promise<void> {
  runningCheck ??= checkThenOpenUpsell(app, medium, onUnlocked).finally(() => {
    runningCheck = null;
  });
  return runningCheck;
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
  return (
    <NewAgentButton
      emphasized={emphasized}
      locked
      onClick={() => void openLockedCustomAgents(app, "custom_agent_dialog", onUnlocked)}
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
