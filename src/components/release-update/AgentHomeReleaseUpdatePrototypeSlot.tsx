import { AgentHomeReleaseUpdatePrompt } from "@/components/release-update/AgentHomeReleaseUpdatePrompt";
import { ReleaseNotesModal } from "@/components/release-update/ReleaseNotesDialog";
import {
  getAgentHomeReleaseUpdatePrototype,
  setAgentHomeReleaseUpdatePrototype,
  subscribeAgentHomeReleaseUpdatePrototype,
} from "@/components/release-update/agentHomeReleaseUpdatePrototypeStore";
import { useApp } from "@/context";
import * as React from "react";

const PROTOTYPE_VERSION = "4.0.4";

export interface AgentHomeReleaseUpdatePrototypeSlotProps {
  visible: boolean;
}

/**
 * Connects the development-only release preview to the global empty Agent Home.
 * The production default is inert because the preview starts hidden.
 */
export function AgentHomeReleaseUpdatePrototypeSlot({
  visible,
}: AgentHomeReleaseUpdatePrototypeSlotProps): React.ReactElement | null {
  const app = useApp();
  const prototypeVisible = React.useSyncExternalStore(
    subscribeAgentHomeReleaseUpdatePrototype,
    getAgentHomeReleaseUpdatePrototype,
    () => false
  );

  // Keep this preview out of project landings and conversations so
  // only people who open the global Copilot home are interrupted.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/317
  if (!visible || !prototypeVisible) {
    return null;
  }

  return (
    <AgentHomeReleaseUpdatePrompt
      onDismiss={() => setAgentHomeReleaseUpdatePrototype(false)}
      onOpen={() => new ReleaseNotesModal(app).open()}
      version={PROTOTYPE_VERSION}
    />
  );
}
