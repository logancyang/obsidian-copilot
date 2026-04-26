import { AgentModeChat } from "@/agentMode";
import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import Chat from "@/components/Chat";
import type ChainManager from "@/LLMProviders/chainManager";
import type CopilotPlugin from "@/main";
import type { FileParserManager } from "@/tools/FileParserManager";
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
 * current chain. Agent Mode renders a fully separate `<AgentModeChat />`
 * tree backed by `AgentChatBackend`; all other chains render the legacy
 * `<Chat />` against `ChatManagerChatUIState`.
 *
 * The two stacks are intentionally independent — the router is the single
 * seam between them, and the only place outside `agentMode/` that knows
 * about the Agent Mode chain.
 */
export const ChatRouter: React.FC<Props> = (props) => {
  const [chain] = useChainType();

  if (chain === ChainType.AGENT_MODE) {
    return (
      <AgentModeChat
        plugin={props.plugin}
        onSaveChat={props.onSaveChat}
        updateUserMessageHistory={props.updateUserMessageHistory}
      />
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
