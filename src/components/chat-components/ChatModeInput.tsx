import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { useSettingsValue } from "@/settings/model";
import { isPlusChain } from "@/utils";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChatInput, { type ChatInputHandle, type ChatInputProps } from "./ChatInput";
import { ChatToolControls } from "./ChatToolControls";

type ChatModeInputProps = Omit<
  ChatInputProps,
  "toolControls" | "onToolPillsChange" | "onTagSelected"
>;

/**
 * Chat-mode wrapper around `ChatInput` that owns the autonomous-agent and
 * vault/web/composer toggle row, the `@vault` / `@websearch` / `@composer`
 * keyword injection at send time, and the pill ↔ toggle synchronization.
 *
 * Agent Mode renders `ChatInput` directly so none of this logic leaks into it.
 */
const ChatModeInput: React.FC<ChatModeInputProps> = (props) => {
  const { handleSendMessage, inputMessage } = props;
  const [currentChain] = useChainType();
  const settings = useSettingsValue();
  const isCopilotPlus = isPlusChain(currentChain);

  const [vaultToggle, setVaultToggle] = useState(false);
  const [webToggle, setWebToggle] = useState(false);
  const [composerToggle, setComposerToggle] = useState(false);
  const [autonomousAgentToggle, setAutonomousAgentToggle] = useState(
    settings.enableAutonomousAgent
  );

  // Force off in Projects mode; otherwise mirror settings.
  useEffect(() => {
    if (currentChain === ChainType.PROJECT_CHAIN) {
      setAutonomousAgentToggle(false);
    } else {
      setAutonomousAgentToggle(settings.enableAutonomousAgent);
    }
  }, [settings.enableAutonomousAgent, currentChain]);

  const chatInputRef = useRef<ChatInputHandle>(null);

  const handleVaultToggleOff = useCallback(() => {
    chatInputRef.current?.removeToolPills(["@vault"]);
  }, []);

  const handleWebToggleOff = useCallback(() => {
    chatInputRef.current?.removeToolPills(["@websearch", "@web"]);
  }, []);

  const handleComposerToggleOff = useCallback(() => {
    chatInputRef.current?.removeToolPills(["@composer"]);
  }, []);

  const handleToolPillsChange = useCallback(
    (toolNames: string[]) => {
      if (autonomousAgentToggle) return;
      setVaultToggle(toolNames.includes("@vault"));
      setWebToggle(toolNames.includes("@websearch") || toolNames.includes("@web"));
      setComposerToggle(toolNames.includes("@composer"));
    },
    [autonomousAgentToggle]
  );

  const handleTagSelected = useCallback(() => {
    if (isCopilotPlus && !autonomousAgentToggle && !vaultToggle) {
      setVaultToggle(true);
      new Notice("Vault search enabled for tag query");
    }
  }, [isCopilotPlus, autonomousAgentToggle, vaultToggle]);

  const wrappedHandleSendMessage: ChatInputProps["handleSendMessage"] = useCallback(
    (metadata: Parameters<ChatInputProps["handleSendMessage"]>[0]) => {
      if (!isCopilotPlus || autonomousAgentToggle) {
        handleSendMessage(metadata);
        return;
      }
      const messageLower = inputMessage.toLowerCase();
      const toolCalls: string[] = [];
      if (vaultToggle && !messageLower.includes("@vault")) {
        toolCalls.push("@vault");
      }
      if (webToggle && !messageLower.includes("@websearch") && !messageLower.includes("@web")) {
        toolCalls.push("@websearch");
      }
      if (composerToggle && !messageLower.includes("@composer")) {
        toolCalls.push("@composer");
      }
      if (toolCalls.length === 0) {
        handleSendMessage(metadata);
        return;
      }
      handleSendMessage({ ...metadata, toolCalls });
    },
    [
      handleSendMessage,
      inputMessage,
      isCopilotPlus,
      autonomousAgentToggle,
      vaultToggle,
      webToggle,
      composerToggle,
    ]
  );

  const toolControls = useMemo(
    () => (
      <ChatToolControls
        vaultToggle={vaultToggle}
        setVaultToggle={setVaultToggle}
        webToggle={webToggle}
        setWebToggle={setWebToggle}
        composerToggle={composerToggle}
        setComposerToggle={setComposerToggle}
        autonomousAgentToggle={autonomousAgentToggle}
        setAutonomousAgentToggle={setAutonomousAgentToggle}
        currentChain={currentChain}
        onVaultToggleOff={handleVaultToggleOff}
        onWebToggleOff={handleWebToggleOff}
        onComposerToggleOff={handleComposerToggleOff}
      />
    ),
    [
      vaultToggle,
      webToggle,
      composerToggle,
      autonomousAgentToggle,
      currentChain,
      handleVaultToggleOff,
      handleWebToggleOff,
      handleComposerToggleOff,
    ]
  );

  return (
    <ChatInput
      {...props}
      ref={chatInputRef}
      handleSendMessage={wrappedHandleSendMessage}
      toolControls={toolControls}
      onToolPillsChange={handleToolPillsChange}
      onTagSelected={handleTagSelected}
    />
  );
};

export default ChatModeInput;
