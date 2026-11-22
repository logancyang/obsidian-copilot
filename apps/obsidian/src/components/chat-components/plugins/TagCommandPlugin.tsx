import React, { useCallback, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, TextNode } from "lexical";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import { useTagSearch, TagSearchOption } from "@/components/chat-components/hooks/useTagSearch";

interface TagCommandPluginProps {
  onTagSelected?: () => void;
}

export function TagCommandPlugin({ onTagSelected }: TagCommandPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [currentQuery, setCurrentQuery] = useState("");

  const filteredTags = useTagSearch(currentQuery, {
    limit: 10,
  });

  const handleSelect = useCallback(
    (option: TagSearchOption) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!(anchorNode instanceof TextNode)) return;

        const textContent = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;

        const triggerIndex = textContent.lastIndexOf("#", cursorOffset);
        if (triggerIndex === -1) return;

        const beforeText = textContent.slice(0, triggerIndex);
        const afterText = textContent.slice(cursorOffset);
        const tagText = `#${option.tag} `;

        anchorNode.setTextContent(beforeText + tagText + afterText);

        const newOffset = beforeText.length + tagText.length;
        anchorNode.select(newOffset, newOffset);
      });

      onTagSelected?.();
    },
    [editor, onTagSelected]
  );

  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "#",
      multiChar: false,
      allowWhitespace: false,
    },
    options: filteredTags,
    onSelect: handleSelect,
    onStateChange: (newState: TypeaheadState) => {
      setCurrentQuery(newState.query);
    },
  });

  return (
    <>
      {state.isOpen && (
        <TypeaheadMenuPortal
          options={filteredTags}
          selectedIndex={state.selectedIndex}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
          range={state.range}
          query={state.query}
          showPreview={false}
        />
      )}
    </>
  );
}
