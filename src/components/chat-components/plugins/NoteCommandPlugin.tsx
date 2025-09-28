import React, { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TFile } from "obsidian";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { useNoteSearch, NoteSearchOption } from "@/components/chat-components/hooks/useNoteSearch";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import {
  $replaceTriggeredTextWithPill,
  PillData,
} from "@/components/chat-components/utils/lexicalTextUtils";
import { NotePreviewCache } from "@/components/chat-components/utils/notePreviewUtils";

interface NoteCommandPluginProps {
  isCopilotPlus?: boolean;
}

export function NoteCommandPlugin({ isCopilotPlus = false }: NoteCommandPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [currentQuery, setCurrentQuery] = useState("");

  // Use shared preview cache
  const [previewCache] = useState(() => new NotePreviewCache());
  const [previewContent, setPreviewContent] = useState<Map<string, string>>(new Map());

  // Function to load note content for preview using shared cache
  const loadNoteContent = useCallback(
    async (file: TFile): Promise<string> => {
      try {
        const content = await previewCache.getOrLoadContent(file, 500);
        setPreviewContent((prev) => {
          const newMap = new Map(prev);
          newMap.set(file.path, content);
          return newMap;
        });
        return content;
      } catch {
        const errorMsg = "Failed to load content";
        setPreviewContent((prev) => {
          const newMap = new Map(prev);
          newMap.set(file.path, errorMsg);
          return newMap;
        });
        return errorMsg;
      }
    },
    [previewCache]
  );

  // Use unified note search hook with standard configuration
  const searchResults = useNoteSearch(currentQuery, isCopilotPlus);

  // Add preview content from cache to the results
  const filteredNotes = searchResults.map((note) => ({
    ...note,
    content: previewContent.get(note.file.path) || "",
  }));

  // Shared selection handler
  const handleSelect = useCallback(
    (option: NoteSearchOption) => {
      const pillData: PillData = {
        type: "notes",
        title: option.title,
        data: option.file,
      };

      editor.update(() => {
        $replaceTriggeredTextWithPill("[[", pillData);
      });
    },
    [editor]
  );

  // Use the shared typeahead hook
  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "[[",
      multiChar: true,
      allowWhitespace: true,
    },
    options: filteredNotes,
    onSelect: handleSelect,
    onStateChange: (newState: TypeaheadState) => {
      setCurrentQuery(newState.query);
    },
    onHighlight: (_index: number, option: NoteSearchOption) => {
      // Load content for the highlighted note if not already loaded
      if (option && !previewContent.has(option.file.path)) {
        loadNoteContent(option.file);
      }
    },
  });

  // Load content for the first note when filteredNotes change
  useEffect(() => {
    if (filteredNotes.length > 0 && !previewContent.has(filteredNotes[0].file.path)) {
      loadNoteContent(filteredNotes[0].file);
    }
  }, [filteredNotes, previewContent, loadNoteContent]);

  return (
    <>
      {state.isOpen && (
        <TypeaheadMenuPortal
          options={filteredNotes}
          selectedIndex={state.selectedIndex}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
          range={state.range}
          query={state.query}
          showPreview={true}
        />
      )}
    </>
  );
}
