import { SetChainOptions } from "@/aiParams";
import { VAULT_VECTOR_STORE_STRATEGY } from "@/constants";
import { CustomError } from "@/error";
import { CopilotSettings } from "@/settings/SettingsPage";
import { App, Notice } from "obsidian";
import React, { useEffect, useState } from "react";

import { ChainType } from "@/chainFactory";
import { AddContextNoteModal } from "@/components/AddContextNoteModal";
import { TooltipActionButton } from "@/components/ChatComponents/TooltipActionButton";
import { stringToChainType } from "@/utils";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, Puzzle, RefreshCw } from "lucide-react";

import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

interface ChatControlsProps {
  currentChain: ChainType;
  setCurrentChain: (chain: ChainType, options?: SetChainOptions) => void;
  onNewChat: (openNote: boolean) => void;
  onSaveAsNote: () => void;
  onRefreshVaultContext: () => void;
  settings: CopilotSettings;
  vault_qa_strategy: string;
  isIndexLoadedPromise: Promise<boolean>;
  app: App;
  contextNotes: TFile[];
  setContextNotes: React.Dispatch<React.SetStateAction<TFile[]>>;
  includeActiveNote: boolean;
  setIncludeActiveNote: React.Dispatch<React.SetStateAction<boolean>>;
  contextUrls: string[];
  onRemoveUrl: (url: string) => void;
  debug?: boolean;
}

const ChatControls: React.FC<ChatControlsProps> = ({
  currentChain,
  setCurrentChain,
  onNewChat,
  onSaveAsNote,
  onRefreshVaultContext,
  settings,
  vault_qa_strategy,
  isIndexLoadedPromise,
  app,
  contextNotes,
  setContextNotes,
  includeActiveNote,
  setIncludeActiveNote,
  contextUrls,
  onRemoveUrl,
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

  const handleChainChange = async ({ value }: { value: string }) => {
    const newChain = stringToChainType(value);
    setSelectedChain(newChain);

    // TODO: Update Copilot Plus Modal to check the license key when ready to ship
    // if (newChain === ChainType.COPILOT_PLUS_CHAIN) {
    //   new CopilotPlusModal(app).open();
    //   // Reset the selected chain to the previous value
    //   setSelectedChain(currentChain);
    // } else {
    //   setCurrentChain(newChain, { debug });
    // }
  };

  useEffect(() => {
    const handleChainSelection = async () => {
      if (!app) {
        console.error("App instance is not available.");
        return;
      }

      if (selectedChain === ChainType.VAULT_QA_CHAIN) {
        if (vault_qa_strategy === VAULT_VECTOR_STORE_STRATEGY.ON_MODE_SWITCH) {
          await onRefreshVaultContext();
        }
      }

      try {
        await setCurrentChain(selectedChain, { debug });
      } catch (error) {
        if (error instanceof CustomError) {
          console.error("Error setting QA chain:", error.msg);
          new Notice(`Error: ${error.msg}. Please check your embedding model settings.`);
        } else {
          console.error("Unexpected error setting QA chain:", error);
          new Notice(
            "An unexpected error occurred while setting up the QA chain. Please check the console for details."
          );
        }
      }
    };

    handleChainSelection();
  }, [selectedChain]);

  useEffect(() => {
    setSelectedChain(settings.defaultChainType);
  }, [settings.defaultChainType]);

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
          setContextNotes((prev) => [...prev, note]);
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
              onNewChat(false);
            }}
            Icon={<RefreshCw className="icon-scaler" />}
          >
            <div>New Chat</div>
            {!settings.autosaveChat && <div>(Unsaved history will be lost)</div>}
          </TooltipActionButton>
          <TooltipActionButton onClick={onSaveAsNote} Icon={<Download className="icon-scaler" />}>
            Save as Note
          </TooltipActionButton>
          {selectedChain === "vault_qa" && (
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
