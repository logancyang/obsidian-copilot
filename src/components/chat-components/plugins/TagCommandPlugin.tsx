import React, { useCallback, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import {
  $replaceTriggeredTextWithPill,
  PillData,
} from "@/components/chat-components/utils/lexicalTextUtils";
import { useTagSearch, TagSearchOption } from "@/components/chat-components/hooks/useTagSearch";

/**
 * TagCommandPlugin provides # typeahead functionality for tags
 * Similar to how [[ works for notes, # allows users to search and insert tags
 */
export function TagCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [currentQuery, setCurrentQuery] = useState("");

  const filteredTags = useTagSearch(currentQuery, {
    limit: 10,
  });

  // Handle tag selection
  const handleSelect = useCallback(
    (option: TagSearchOption) => {
      const pillData: PillData = {
        type: "tags",
        title: option.tag,
        data: `#${option.tag}`, // Store with # prefix
      };

      editor.update(() => {
        $replaceTriggeredTextWithPill("#", pillData);
      });
    },
    [editor]
  );

  // Use the shared typeahead hook
  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "#",
      multiChar: false,
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
