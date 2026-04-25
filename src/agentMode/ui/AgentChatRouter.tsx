import { useChainType } from "@/aiParams";
import AgentChat from "@/agentMode/ui/AgentChat";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import {
  useActiveBackendDescriptor,
  useBackendInstallState,
} from "@/agentMode/ui/useBackendDescriptor";
import Chat from "@/components/Chat";
import { ChainType } from "@/chainFactory";
import type CopilotPlugin from "@/main";
import type ChainManager from "@/LLMProviders/chainManager";
import type { FileParserManager } from "@/tools/FileParserManager";
import { logError } from "@/logger";
import React from "react";

interface Props {
  chainManager: ChainManager;
  updateUserMessageHistory: (newMessage: string) => void;
  fileParserManager: FileParserManager;
  plugin: CopilotPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
}

/**
 * Top-level router that decides which chat surface to render based on the
 * current chain. Agent Mode renders a fully separate `<AgentChat />` tree
 * backed by `AgentChatBackend`; all other chains render the legacy
 * `<Chat />` against `ChatManagerChatUIState`.
 *
 * In Agent Mode without a started session (binary missing, booting, error),
 * we render `<AgentModeStatus />` standalone — no `<Chat />` fallback so the
 * user can't accidentally send into the legacy stack.
 */
export const AgentChatRouter: React.FC<Props> = (props) => {
  const [chain] = useChainType();
  const manager = props.plugin.agentSessionManager;
  const descriptor = useActiveBackendDescriptor();
  const installState = useBackendInstallState(descriptor);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  // Auto-spawn the backend on chain switch. The manager de-dupes concurrent
  // callers via prepareSession, so this is safe to fire whenever the
  // dependencies change. Skip if the backend isn't installed (the install pill
  // takes over) or there's a prior boot error (Retry handles it).
  React.useEffect(() => {
    if (!manager) return;
    if (chain !== ChainType.AGENT_MODE) return;
    if (manager.getActiveSession()) return;
    if (manager.getIsStarting()) return;
    if (manager.getLastError()) return;
    if (installState.kind === "absent") return;
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] auto-start failed", e);
    });
    // tick forces re-evaluation when the manager's active session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, manager, installState.kind, tick]);

  const handleInstall = React.useCallback(() => {
    descriptor.openInstallUI(props.plugin);
  }, [descriptor, props.plugin]);

  if (chain === ChainType.AGENT_MODE) {
    if (!manager) return null;
    const backend = manager.getActiveChatUIState();
    if (backend) {
      return (
        <AgentChat
          backend={backend}
          manager={manager}
          plugin={props.plugin}
          onSaveChat={props.onSaveChat}
          updateUserMessageHistory={props.updateUserMessageHistory}
        />
      );
    }
    // No active backend (binary missing, booting, or boot error). Render the
    // chain switcher above the status pill so the user can still leave Agent
    // Mode without going through settings or the command palette.
    return (
      <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
        <div className="tw-flex-1" />
        <AgentModeStatus manager={manager} onInstallClick={handleInstall} />
        <AgentChatControls />
      </div>
    );
  }

  return (
    <Chat
      chainManager={props.chainManager}
      updateUserMessageHistory={props.updateUserMessageHistory}
      fileParserManager={props.fileParserManager}
      plugin={props.plugin}
      onSaveChat={props.onSaveChat}
      chatUIState={props.plugin.chatUIState}
    />
  );
};
