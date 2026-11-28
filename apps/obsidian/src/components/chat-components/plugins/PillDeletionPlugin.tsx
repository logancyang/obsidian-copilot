import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  DELETE_CHARACTER_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  $isElementNode,
  DecoratorNode,
  LexicalNode,
} from "lexical";

export interface IPillNode {
  isPill(): boolean;
}

function $isPillNode(node: LexicalNode): node is DecoratorNode<React.ReactNode> & IPillNode {
  if (!(node instanceof DecoratorNode)) {
    return false;
  }

  const maybePill = node as { isPill?: () => boolean };
  return typeof maybePill.isPill === "function" && maybePill.isPill() === true;
}

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

          if ($isPillNode(anchorNode)) {
            if ((isBackward && anchor.offset === 1) || (!isBackward && anchor.offset === 0)) {
              anchorNode.remove();
              handled = true;
            }
            return;
          }

          if ($isElementNode(anchorNode) && isBackward && anchor.offset > 0) {
            const children = anchorNode.getChildren();
            const prevChild = children[anchor.offset - 1];

            if ($isPillNode(prevChild)) {
              prevChild.remove();
              handled = true;
              return;
            }
          }

          if (isBackward && anchor.offset === 0) {
            const previousSibling = anchorNode.getPreviousSibling();
            if (previousSibling && $isPillNode(previousSibling)) {
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
