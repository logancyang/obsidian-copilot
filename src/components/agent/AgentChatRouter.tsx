import { useChainType } from "@/aiParams";
import Chat from "@/components/Chat";
import { AgentModeStatus } from "@/components/agent/AgentModeStatus";
import { OpencodeInstallModal } from "@/components/agent/OpencodeInstallModal";
import { ChainType } from "@/chainFactory";
import { computeInstallState } from "@/LLMProviders/agentMode/backends/OpencodeBinaryManager";
import { resolveOpencodeTarget } from "@/LLMProviders/agentMode/backends/platformResolver";
import type CopilotPlugin from "@/main";
import type ChainManager from "@/LLMProviders/chainManager";
import type { FileParserManager } from "@/tools/FileParserManager";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import React from "react";

interface Props {
  chainManager: ChainManager;
  updateUserMessageHistory: (newMessage: string) => void;
  fileParserManager: FileParserManager;
  plugin: CopilotPlugin;
  onSaveChat: (saveAsNote: () => Promise<void>) => void;
}

/**
 * Decides which `ChatUIState` `<Chat />` is rendered against:
 * - Legacy chains → `plugin.chatUIState` (ChatManager-backed).
 * - AGENT_MODE with a started session → the session's `AgentSessionChatUIState`.
 * - AGENT_MODE without a session yet → still `plugin.chatUIState` (the chat
 *   surface stays usable in case the user toggles back). The `AgentModeStatus`
 *   pill prompts them to install/start.
 *
 * Re-renders when the chain type changes or the manager fires an active-
 * session change (post-spawn). We deliberately don't auto-spawn the backend
 * on chain change — the user needs to confirm via the install modal first.
 */
export const AgentChatRouter: React.FC<Props> = (props) => {
  const [chain] = useChainType();
  const manager = props.plugin.agentSessionManager;
  const settings = useSettingsValue();
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  // Auto-spawn the backend on chain switch. The manager de-dupes concurrent
  // callers via prepareSession, so this is safe to fire whenever the
  // dependencies change. Skip if the binary isn't installed (the install pill
  // takes over) or there's a prior boot error (Retry handles it).
  React.useEffect(() => {
    if (!manager) return;
    if (chain !== ChainType.AGENT_MODE) return;
    if (manager.getActiveSession()) return;
    if (manager.getIsStarting()) return;
    if (manager.getLastError()) return;
    const installState = computeInstallState(settings.agentMode);
    if (installState.kind === "absent") return;
    manager.getOrCreateActiveSession().catch((e) => {
      logError("[AgentMode] auto-start failed", e);
    });
  }, [chain, manager, settings.agentMode, tick]);

  const chatUIState = React.useMemo(() => {
    if (chain === ChainType.AGENT_MODE && manager) {
      const agent = manager.getActiveChatUIState();
      if (agent) return agent;
    }
    return props.plugin.chatUIState;
    // tick forces re-evaluation when the manager's active session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, manager, tick, props.plugin.chatUIState]);

  const isAgentMode = chain === ChainType.AGENT_MODE;
  const isAgentReady = isAgentMode && !!manager?.getActiveChatUIState();

  const handleInstall = React.useCallback(async () => {
    const binMgr = props.plugin.opencodeBinaryManager;
    if (!binMgr) return;
    const target = await resolveOpencodeTarget();
    new OpencodeInstallModal(props.plugin.app, binMgr, {
      platform: target.target.platform,
      arch: target.target.arch,
    }).open();
  }, [props.plugin]);

  return (
    <>
      {isAgentMode ? <AgentModeStatus manager={manager} onInstallClick={handleInstall} /> : null}
      <Chat
        chainManager={props.chainManager}
        updateUserMessageHistory={props.updateUserMessageHistory}
        fileParserManager={props.fileParserManager}
        plugin={props.plugin}
        onSaveChat={props.onSaveChat}
        chatUIState={chatUIState}
        isAgentReady={isAgentReady}
      />
    </>
  );
};
