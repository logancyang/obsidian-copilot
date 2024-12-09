import { useChainType } from "@/aiParams";
import { App } from "obsidian";
import React from "react";

import { ChainType } from "@/chainFactory";
import { TooltipActionButton } from "@/components/chat-components/TooltipActionButton";
import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { stringToChainType } from "@/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, MessageCirclePlus, Puzzle } from "lucide-react";

import { NewChatConfirmModal } from "@/components/modals/NewChatConfirmModal";
import { useSettingsValue } from "@/settings/model";
import { ChatMessage } from "@/sharedState";
import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

interface ChatControlsProps {
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  app: App;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: React.Dispatch<React.SetStateAction<boolean>>;
  activeNote: TFile | null;
  contextUrls: string[];
  onRemoveUrl: (url: string) => void;
  chatHistory: ChatMessage[];
}

const ChatControls: React.FC<ChatControlsProps> = ({
  onNewChat,
  onSaveAsNote,
  onRefreshVaultContext,
  app,
  contextNotes,
  setContextNotes,
  includeActiveNote,
  setIncludeActiveNote,
  activeNote,
  contextUrls,
  onRemoveUrl,
  chatHistory,
}) => {
  const [selectedChain, setSelectedChain] = useChainType();
  const settings = useSettingsValue();

  const handleChainChange = async ({ value }: { value: string }) => {
    const newChain = stringToChainType(value);
    setSelectedChain(newChain);
  };

  const handleAddContext = () => {
    const excludeNotes = [
      ...contextNotes.map((note) => note.path),
      ...(includeActiveNote && activeNote ? [activeNote.path] : []),
    ].filter(Boolean) as string[];

    new AddContextNoteModal({
      app,
      onNoteSelect: (note) => {
        if (activeNote && note.path === activeNote.path) {
          setIncludeActiveNote(true);
          // Remove the note from contextNotes if it exists there
          setContextNotes((prev) => prev.filter((n) => n.path !== note.path));
        } else {
          // Add wasAddedManually flag to distinguish from reference-added notes
          setContextNotes((prev) => [...prev, Object.assign(note, { wasAddedManually: true })]);
        }
      },
      excludeNotes,
    }).open();
  };

  const handleRemoveContext = (path: string) => {
    // First check if this note was added manually
    const noteToRemove = contextNotes.find((note) => note.path === path);
    const wasAddedManually = noteToRemove && (noteToRemove as any).wasAddedManually;

    if (wasAddedManually) {
      // If it was added manually, just remove it from contextNotes
      setContextNotes((prev) => prev.filter((note) => note.path !== path));
    } else {
      // If it wasn't added manually, it could be either:
      // 1. The active note (controlled by includeActiveNote)
      // 2. A note added via [[reference]]
      // In either case, we should:
      setIncludeActiveNote(false); // Turn off includeActiveNote if this was the active note
      setContextNotes((prev) => prev.filter((note) => note.path !== path)); // Remove from contextNotes if it was there
    }
  };

  return (
    <div className="chat-controls-wrapper">
      <div className="chat-icons-container">
        {selectedChain === ChainType.COPILOT_PLUS_CHAIN && (
          <ChatContextMenu
            activeNote={includeActiveNote ? activeNote : null}
            contextNotes={contextNotes}
            onAddContext={handleAddContext}
            onRemoveContext={handleRemoveContext}
            contextUrls={contextUrls}
            onRemoveUrl={onRemoveUrl}
          />
        )}
        <div className="chat-icons-right">
          <TooltipActionButton
            onClick={() => {
              if (!settings.autosaveChat && chatHistory.length > 0) {
                new NewChatConfirmModal(app, () => {
                  onNewChat(false);
                }).open();
              } else {
                onNewChat(false);
              }
            }}
            Icon={<MessageCirclePlus className="icon-scaler" />}
          >
            <div>New Chat</div>
            {!settings.autosaveChat && <div>(Unsaved history will be lost)</div>}
          </TooltipActionButton>
          <TooltipActionButton onClick={onSaveAsNote} Icon={<Download className="icon-scaler" />}>
            Save as Note
          </TooltipActionButton>
          {(selectedChain === ChainType.VAULT_QA_CHAIN ||
            selectedChain === ChainType.COPILOT_PLUS_CHAIN) && (
            <TooltipActionButton
              onClick={onRefreshVaultContext}
              Icon={<Puzzle className="icon-scaler" />}
            >
              Refresh Index for Vault
            </TooltipActionButton>
          )}
          <div className="chat-icon-selection-tooltip">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className="chain-select-button">
                {selectedChain === ChainType.LLM_CHAIN && "chat"}
                {selectedChain === ChainType.VAULT_QA_CHAIN && "vault QA (basic)"}
                {selectedChain === ChainType.COPILOT_PLUS_CHAIN && "copilot plus (alpha)"}
                <ChevronDown size={10} />
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content className="chain-select-content" align="end" sideOffset={5}>
                  <DropdownMenu.Item
                    onSelect={() => handleChainChange({ value: ChainType.LLM_CHAIN })}
                  >
                    chat
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => handleChainChange({ value: ChainType.VAULT_QA_CHAIN })}
                  >
                    vault QA (basic)
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => handleChainChange({ value: ChainType.COPILOT_PLUS_CHAIN })}
                  >
                    copilot plus (alpha)
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatControls;
