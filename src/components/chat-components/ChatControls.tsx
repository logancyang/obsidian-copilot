import { SetChainOptions } from "@/aiParams";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { CustomError } from "@/error";
import { App, Notice } from "obsidian";
import React, { useEffect, useState } from "react";

import { ChainType } from "@/chainFactory";
import { TooltipActionButton } from "@/components/chat-components/TooltipActionButton";
import { AddContextNoteModal } from "@/components/modals/AddContextNoteModal";
import { useSettingsValueContext } from "@/settings/contexts/SettingsValueContext";
import { stringToChainType } from "@/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, MessageCirclePlus, Puzzle } from "lucide-react";

import { NewChatConfirmModal } from "@/components/modals/NewChatConfirmModal";
import { ChatMessage } from "@/sharedState";
import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

interface ChatControlsProps {
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  isIndexLoadedPromise: Promise<boolean>;
  app: App;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: React.Dispatch<React.SetStateAction<boolean>>;
  contextUrls: string[];
  onRemoveUrl: (url: string) => void;
  chatHistory: ChatMessage[];
  debug?: boolean;
}

const ChatControls: React.FC<ChatControlsProps> = ({
  currentChain,
  setCurrentChain,
  onNewChat,
  onSaveAsNote,
  onRefreshVaultContext,
  isIndexLoadedPromise,
  app,
  contextNotes,
  setContextNotes,
  includeActiveNote,
  setIncludeActiveNote,
  contextUrls,
  onRemoveUrl,
  chatHistory,
  debug,
}) => {
  const [selectedChain, setSelectedChain] = useState<ChainType>(currentChain);
  const [isIndexLoaded, setIsIndexLoaded] = useState(false);
  const activeNote = app.workspace.getActiveFile();

  useEffect(() => {
    isIndexLoadedPromise.then((loaded) => {
      setIsIndexLoaded(loaded);
    });
  }, [isIndexLoadedPromise]);
  const settings = useSettingsValueContext();
  const indexVaultToVectorStore = settings.indexVaultToVectorStore;

  const handleChainChange = async ({ value }: { value: string }) => {
    const newChain = stringToChainType(value);
    setSelectedChain(newChain);
  };

  useEffect(() => {
    const handleChainSelection = async () => {
      if (!app) {
        console.error("App instance is not available.");
        return;
      }

      try {
        if (
          (selectedChain === ChainType.VAULT_QA_CHAIN ||
            selectedChain === ChainType.COPILOT_PLUS_CHAIN) &&
          indexVaultToVectorStore === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH
        ) {
          await setCurrentChain(selectedChain, {
            debug,
            refreshIndex: true,
          });
        } else {
          await setCurrentChain(selectedChain, { debug });
        }
      } catch (error) {
        if (error instanceof CustomError) {
          console.error("Error setting chain:", error.msg);
          new Notice(`Error: ${error.msg}. Please check your embedding model settings.`);
        } else {
          console.error("Unexpected error setting chain:", error);
          new Notice(
            "An unexpected error occurred while setting up the chain. Please check the console for details."
          );
        }
      }
    };

    handleChainSelection();
  }, [selectedChain]);

  // const handleFindSimilarNotes = async () => {
  //   const activeFile = app.workspace.getActiveFile();
  //   if (!activeFile) {
  //     new Notice("No active file");
  //     return;
  //   }

  //   const activeNoteContent = await app.vault.cachedRead(activeFile);
  //   const similarChunks = await onFindSimilarNotes(activeNoteContent, activeFile.path);
  //   new SimilarNotesModal(app, similarChunks).open();
  // };

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
    if (activeNote && path === activeNote.path) {
      setIncludeActiveNote(false);
    } else {
      setContextNotes((prev) => prev.filter((note) => note.path !== path));
    }
  };

  return (
    <div className="chat-controls-wrapper">
      <div className="chat-icons-container">
        {currentChain === ChainType.COPILOT_PLUS_CHAIN && (
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
                {currentChain === "llm_chain" && "chat"}
                {currentChain === "vault_qa" && "vault QA (basic)"}
                {currentChain === "copilot_plus" && "copilot plus (alpha)"}
                <ChevronDown size={10} />
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content className="chain-select-content" align="end" sideOffset={5}>
                  <DropdownMenu.Item onSelect={() => handleChainChange({ value: "llm_chain" })}>
                    chat
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => handleChainChange({ value: "vault_qa" })}
                    disabled={!isIndexLoaded}
                    className={!isIndexLoaded ? "disabled-menu-item" : ""}
                  >
                    vault QA (basic) {!isIndexLoaded && "(index not loaded)"}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    onSelect={() => handleChainChange({ value: "copilot_plus" })}
                    disabled={!isIndexLoaded}
                    className={!isIndexLoaded ? "disabled-menu-item" : ""}
                  >
                    copilot plus (alpha) {!isIndexLoaded && "(index not loaded)"}
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
