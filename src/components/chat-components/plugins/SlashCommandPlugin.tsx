import React, { useCallback, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, TextNode } from "lexical";
import fuzzysort from "fuzzysort";
import { useCustomCommands } from "@/commands/state";
import { CustomCommand } from "@/commands/type";
import { sortSlashCommands } from "@/commands/customCommandUtils";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import { $replaceTextRangeWithPills } from "@/components/chat-components/utils/lexicalTextUtils";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";

interface SlashCommandOption extends TypeaheadOption {
  command: CustomCommand;
}

export function SlashCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const commands = useCustomCommands();
  const [currentQuery, setCurrentQuery] = useState("");

  // Get all available slash commands
  const allCommands = useMemo(() => {
    const slashCommands = sortSlashCommands(commands.filter((cmd) => cmd.showInSlashMenu));

    return slashCommands.map((command, index) => ({
      key: `${command.title}-${index}`,
      title: command.title,
      content: command.content,
      command,
    }));
  }, [commands]);

  // Filter commands based on query using fuzzysort
  const filteredCommands = useMemo(() => {
    if (!currentQuery) {
      return allCommands.slice(0, 10); // Show first 10 commands when no query
    }

    const query = currentQuery;

    // Use fuzzysort to search through command titles
    const titleResults = fuzzysort.go(query, allCommands, {
      key: "title",
      limit: 10,
      threshold: -10000, // Allow more lenient matching
    });

    // If we have good title matches, use those
    if (titleResults.length > 0) {
      return titleResults.map((result) => result.obj);
    }

    // Fallback to content search if no title matches
    const contentResults = fuzzysort.go(query, allCommands, {
      key: "content",
      limit: 5,
      threshold: -10000,
    });

    return contentResults.map((result) => result.obj);
  }, [allCommands, currentQuery]);

  // Shared selection handler
  const handleSelect = useCallback(
    (option: SlashCommandOption) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        // Find the slash position
        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();
        if (anchorNode instanceof TextNode) {
          const textContent = anchorNode.getTextContent();
          const slashIndex = textContent.lastIndexOf("/", anchor.offset);

          if (slashIndex !== -1) {
            // Use the existing API to replace text with automatic pill conversion
            const insertedText = option.content || option.title;
            $replaceTextRangeWithPills(slashIndex, anchor.offset, insertedText, {
              enableURLPills: true, // Enable URL pill conversion for templates
            });
          }
        }
      });
    },
    [editor]
  );

  // Use the shared typeahead hook
  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "/",
    },
    options: filteredCommands,
    onSelect: handleSelect,
    onStateChange: (newState: TypeaheadState) => {
      setCurrentQuery(newState.query);
    },
  });

  return (
    <>
      {state.isOpen && (
        <TypeaheadMenuPortal
          options={filteredCommands}
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
