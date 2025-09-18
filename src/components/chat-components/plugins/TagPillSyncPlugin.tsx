import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $isTagPillNode } from "../TagPillNode";

interface TagPillSyncPluginProps {
  onTagsChange?: (tags: string[]) => void;
  onTagsRemoved?: (removedTags: string[]) => void;
}

export function TagPillSyncPlugin({ onTagsChange, onTagsRemoved }: TagPillSyncPluginProps): null {
  const [editor] = useLexicalComposerContext();
  const [previousTags, setPreviousTags] = React.useState<string[]>([]);

  React.useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const currentTags: string[] = [];

        // Traverse all nodes to find tag pills
        function traverse(node: any): void {
          if ($isTagPillNode(node)) {
            const tagName = node.getTagName();
            if (!currentTags.includes(tagName)) {
              currentTags.push(tagName);
            }
          }

          if (node.getChildren) {
            const children = node.getChildren();
            children.forEach(traverse);
          }
        }

        traverse(root);

        // Check for changes
        const added = currentTags.filter((tag) => !previousTags.includes(tag));
        const removed = previousTags.filter((tag) => !currentTags.includes(tag));

        if (added.length > 0 || removed.length > 0) {
          // Update callbacks
          if (onTagsChange && currentTags.length > 0) {
            onTagsChange(currentTags);
          }

          if (onTagsRemoved && removed.length > 0) {
            onTagsRemoved(removed);
          }

          // Update previous state
          setPreviousTags(currentTags);
        }
      });
    });
  }, [editor, onTagsChange, onTagsRemoved, previousTags]);

  return null;
}
