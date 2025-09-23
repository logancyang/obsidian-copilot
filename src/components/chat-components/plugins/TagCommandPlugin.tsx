import React, { useCallback, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import fuzzysort from "fuzzysort";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import {
  $replaceTriggeredTextWithPill,
  PillData,
} from "@/components/chat-components/utils/lexicalTextUtils";
import { getTagsFromNote } from "@/utils";

interface TagOption extends TypeaheadOption {
  tag: string;
}

/**
 * TagCommandPlugin provides # typeahead functionality for tags
 * Similar to how [[ works for notes, # allows users to search and insert tags
 */
export function TagCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const [currentQuery, setCurrentQuery] = useState("");

  // Get all available tags from the vault
  const allTags = useMemo(() => {
    if (!app?.vault) {
      return [];
    }

    const tags = new Set<string>();

    // Use existing utility to get frontmatter tags from all markdown files
    app.vault.getMarkdownFiles().forEach((file) => {
      const fileTags = getTagsFromNote(file, true); // true = frontmatter only
      fileTags.forEach((tag) => tags.add(tag));
    });

    return Array.from(tags).map((tag, index) => ({
      key: `tag-${tag}-${index}`,
      title: tag,
      subtitle: `#${tag}`,
      content: "", // Tags don't have preview content
      tag: tag,
    }));
  }, []);

  // Filter tags based on query using fuzzysort
  const filteredTags = useMemo(() => {
    if (!currentQuery) {
      return allTags.slice(0, 10); // Show first 10 tags when no query
    }

    // Use fuzzysort to search through tag names
    const results = fuzzysort.go(currentQuery, allTags, {
      key: "title",
      limit: 10,
      threshold: -10000, // Allow more lenient matching
    });

    return results.map((result) => result.obj);
  }, [allTags, currentQuery]);

  // Handle tag selection
  const handleSelect = useCallback(
    (option: TagOption) => {
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
