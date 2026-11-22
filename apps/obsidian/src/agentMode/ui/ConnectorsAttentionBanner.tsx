import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import type { ConnectionManager } from "@/connectors/connectionManager";
import { useIsConnectorsEnabled } from "@/connectors/connectorsEntitlement";
import { useConnectorsSnapshot } from "@/connectors/ui/useConnectorsSnapshot";
import { useApp } from "@/context";
import { openCopilotSettings } from "@/settings/openSettings";
import React from "react";

interface ConnectorsAttentionBannerProps {
  manager: ConnectionManager | undefined;
}

export function ConnectorsAttentionBanner({
  manager,
}: ConnectorsAttentionBannerProps): React.ReactElement | null {
  const app = useApp();
  const snapshot = useConnectorsSnapshot(manager);
  const enabled = useIsConnectorsEnabled();
  // Only a Supporter can reconnect, and mobile has no connection manager, so neither gets a banner it can't act on.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/859
  if (enabled !== true || !snapshot?.needsAttention) return null;

  return (
    <AgentStatusCard
      layout="row"
      message="You have connectors that need your attention"
      action={{
        label: "Manage",
        onClick: (event) => openCopilotSettings(app, event.currentTarget.win, "connectors"),
      }}
    />
  );
}
