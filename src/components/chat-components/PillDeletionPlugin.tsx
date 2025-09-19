import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  DELETE_CHARACTER_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  $isElementNode,
  DecoratorNode,
} from "lexical";

/**
 * Interface for nodes that should be treated as pills for deletion purposes
 */
export interface IPillNode {
  isPill(): boolean;
}

/**
 * Check if a node is a pill-like node (any DecoratorNode that implements IPillNode)
 */
function $isPillNode(node: any): node is DecoratorNode<any> & IPillNode {
  // Check if it's a DecoratorNode (all pills extend DecoratorNode)
  if (!(node instanceof DecoratorNode)) {
    return false;
  }

  // Check if it implements the IPillNode interface
  return typeof (node as any).isPill === "function" && (node as any).isPill() === true;
}

/**
 * Centralized plugin for handling deletion of all pill types.
 * This replaces the deletion logic that was scattered across individual pill plugins.
 */
export function PillDeletionPlugin(): null {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    const removeDeleteCommand = editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      (isBackward: boolean): boolean => {
        let handled = false;

        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            handled = false;
            return;
          }

          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();

          // Case 1: Cursor is directly ON a pill node
          // Examples: [[Note]]| (cursor after) or |[[Note]] (cursor before)
          if ($isPillNode(anchorNode)) {
            if ((isBackward && anchor.offset === 1) || (!isBackward && anchor.offset === 0)) {
              anchorNode.remove();
              handled = true;
            }
            return;
          }

          // Case 2: Cursor is BETWEEN elements in a paragraph
          // Examples: "Hello [[Note]]|" or "[[Note1]]|[[Note2]]"
          // The cursor is at paragraph level, positioned after a pill
          if ($isElementNode(anchorNode) && isBackward && anchor.offset > 0) {
            const children = anchorNode.getChildren();
            const prevChild = children[anchor.offset - 1];

            if ($isPillNode(prevChild)) {
              prevChild.remove();
              handled = true;
              return;
            }
          }

          // Case 3: Cursor is at START of a text node (commented out)
          // Example: "[[Note]]|text" where cursor is at the start of "text"
          // Currently disabled since typeahead adds spaces after pills
          if (isBackward && anchor.offset === 0) {
            const previousSibling = anchorNode.getPreviousSibling();
            if ($isPillNode(previousSibling)) {
              previousSibling.remove();
              handled = true;
              return;
            }
          }

          handled = false;
        });

        return handled;
      },
      COMMAND_PRIORITY_CRITICAL
    );

    return () => {
      removeDeleteCommand();
    };
  }, [editor]);

  return null;
}
