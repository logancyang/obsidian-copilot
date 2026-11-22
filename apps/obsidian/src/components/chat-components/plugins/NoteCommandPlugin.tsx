import React, { useCallback, useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TFile } from "obsidian";
import { useApp } from "@/context";
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
  currentActiveFile?: TFile | null;
}

export function NoteCommandPlugin({
  currentActiveFile = null,
}: NoteCommandPluginProps): JSX.Element {
  const app = useApp();
  const [editor] = useLexicalComposerContext();
  const [currentQuery, setCurrentQuery] = useState("");

  const [previewCache] = useState(() => new NotePreviewCache(app));
  const [previewContent, setPreviewContent] = useState<Map<string, string>>(() => new Map());

  const loadNoteContent = useCallback(
    async (file: TFile): Promise<string> => {
      try {
        const content = await previewCache.getOrLoadContent(file);
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

  const searchResults = useNoteSearch(currentQuery, {}, currentActiveFile);

  const filteredNotes = searchResults.map((note) => ({
    ...note,
    content: previewContent.get(note.file.path) || "",
  }));

  const handleSelect = useCallback(
    (option: NoteSearchOption) => {
      if (option.category === "activeNote") {
        editor.update(() => {
          $replaceTriggeredTextWithPill("[[", { type: "active-note" });
        });
      } else {
        const pillData: PillData = {
          type: "notes",
          title: option.title,
          data: option.file,
        };

        editor.update(() => {
          $replaceTriggeredTextWithPill("[[", pillData);
        });
      }
    },
    [editor]
  );

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
      if (option && !previewContent.has(option.file.path)) {
        void loadNoteContent(option.file);
      }
    },
  });

  useEffect(() => {
    if (filteredNotes.length > 0 && !previewContent.has(filteredNotes[0].file.path)) {
      void loadNoteContent(filteredNotes[0].file);
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
