/**
 * DiscussInput - Chat input for Projects+ Discuss feature
 *
 * Uses shared components for consistent styling with main ChatInput.
 */

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChatEditorCore, ChatEditorCoreRef } from "@/components/shared/ChatEditorCore";
import { InputContainer } from "@/components/shared/InputContainer";
import { InputToolbar } from "@/components/shared/InputToolbar";
import { SendStopButton } from "@/components/shared/SendStopButton";
import { ContextRow } from "@/components/shared/ContextRow";
import { ContextNoteBadge } from "@/components/chat-components/ContextBadges";
import { DiscussNoteTypeahead } from "./DiscussNoteTypeahead";
import { Project } from "@/types/projects-plus";
import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { App, TFile } from "obsidian";

interface DiscussInputProps {
  project: Project;
  onSend: (text: string, forcedNotes: TFile[]) => void;
  disabled?: boolean;
  app: App;
  onAbort?: () => void;
}

/**
 * Chat input component for Discuss feature
 */
export function DiscussInput({
  project,
  onSend,
  disabled = false,
  app,
  onAbort,
}: DiscussInputProps) {
  const editorRef = useRef<ChatEditorCoreRef>(null);
  const [selectedNotes, setSelectedNotes] = useState<TFile[]>([]);
  const [showTypeahead, setShowTypeahead] = useState(false);

  // Get project notes as TFile objects
  const projectNotes = useMemo(() => {
    return project.notes
      .map((n) => app.vault.getAbstractFileByPath(n.path))
      .filter((f): f is TFile => f instanceof TFile);
  }, [project.notes, app.vault]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      onSend(text, selectedNotes);
      editorRef.current?.clear();
      setSelectedNotes([]);
    },
    [onSend, selectedNotes]
  );

  const handleNoteSelect = useCallback((note: TFile) => {
    setSelectedNotes((prev) => [...prev, note]);
  }, []);

  const handleRemoveNote = useCallback((path: string) => {
    setSelectedNotes((prev) => prev.filter((n) => n.path !== path));
  }, []);

  const handleSendClick = useCallback(() => {
    const text = editorRef.current?.getText() || "";
    handleSubmit(text);
  }, [handleSubmit]);

  const handleStop = useCallback(() => {
    onAbort?.();
  }, [onAbort]);

  // Check if project has any notes to add
  const hasAvailableNotes = projectNotes.length > selectedNotes.length;

  return (
    <InputContainer>
      {/* Row 1: Context controls - @ button and note badges */}
      <ContextRow
        triggerButton={
          hasAvailableNotes ? (
            <Popover open={showTypeahead} onOpenChange={setShowTypeahead}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost2"
                  size="fit"
                  className="tw-ml-1 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-text-muted"
                  disabled={disabled}
                >
                  <span className="tw-text-base tw-font-medium tw-leading-none">@</span>
                  {selectedNotes.length === 0 && (
                    <span className="tw-pr-1 tw-text-sm tw-leading-4">Add note</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="tw-w-[300px] tw-p-0"
                align="start"
                side="top"
                sideOffset={4}
              >
                <DiscussNoteTypeahead
                  projectNotes={projectNotes}
                  selectedNotes={selectedNotes}
                  isOpen={showTypeahead}
                  onClose={() => setShowTypeahead(false)}
                  onSelect={handleNoteSelect}
                />
              </PopoverContent>
            </Popover>
          ) : selectedNotes.length > 0 ? (
            // Show disabled @ button when all notes are selected
            <Button
              variant="ghost2"
              size="fit"
              className="tw-ml-1 tw-rounded-sm tw-border tw-border-solid tw-border-border tw-text-muted tw-opacity-50"
              disabled
            >
              <span className="tw-text-base tw-font-medium tw-leading-none">@</span>
            </Button>
          ) : null
        }
      >
        {selectedNotes.map((note) => (
          <ContextNoteBadge
            key={note.path}
            note={note}
            onRemove={() => handleRemoveNote(note.path)}
          />
        ))}
      </ContextRow>

      {/* Row 2: Editor */}
      <div className="tw-relative">
        <ChatEditorCore
          ref={editorRef}
          onSubmit={handleSubmit}
          placeholder="Ask about your project..."
          disabled={disabled}
        />
      </div>

      {/* Row 3: Toolbar */}
      <InputToolbar
        right={
          <SendStopButton
            isGenerating={disabled}
            onSend={handleSendClick}
            onStop={handleStop}
            sendLabel="send"
          />
        }
      />
    </InputContainer>
  );
}
