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

/**
 * TagCommandPlugin provides # typeahead functionality for tags
 * Inserts tags as raw text (#tag) instead of pills, so search v3 can process them
 */
export function TagCommandPlugin({ onTagSelected }: TagCommandPluginProps): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [currentQuery, setCurrentQuery] = useState("");

  const filteredTags = useTagSearch(currentQuery, {
    limit: 10,
  });

  // Handle tag selection - insert as raw text instead of pill
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

        // Find the # trigger position
        const triggerIndex = textContent.lastIndexOf("#", cursorOffset);
        if (triggerIndex === -1) return;

        // Replace from # to cursor with the tag text
        const beforeText = textContent.slice(0, triggerIndex);
        const afterText = textContent.slice(cursorOffset);
        const tagText = `#${option.tag} `;

        // Replace the text content
        anchorNode.setTextContent(beforeText + tagText + afterText);

        // Set cursor after the inserted tag and space
        const newOffset = beforeText.length + tagText.length;
        anchorNode.select(newOffset, newOffset);
      });

      // Notify parent that a tag was selected from typeahead
      onTagSelected?.();
    },
    [editor, onTagSelected]
  );

  // Use the shared typeahead hook
  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "#",
      multiChar: false,
      allowWhitespace: false, // Close typeahead when space is typed
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
          showPreview={false} // Tags don't need preview
        />
      )}
    </>
  );
}
