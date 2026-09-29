import { useChainType } from "@/aiParams";
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

  useEffect(() => {
    /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- mirror the persisted setting into the local toggle; the toggle is also user-editable so it can't be pure derived state */
    setAutonomousAgentToggle(settings.enableAutonomousAgent);
    /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resume checking after the persisted-state synchronization */
  }, [settings.enableAutonomousAgent]);

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
