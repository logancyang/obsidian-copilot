import React from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getRoot } from "lexical";
import { $isToolPillNode } from "../ToolPillNode";

interface ToolPillSyncPluginProps {
  onToolsChange?: (tools: string[]) => void;
  onToolsRemoved?: (removedTools: string[]) => void;
}

export function ToolPillSyncPlugin({
  onToolsChange,
  onToolsRemoved,
}: ToolPillSyncPluginProps): null {
  const [editor] = useLexicalComposerContext();
  const [previousTools, setPreviousTools] = React.useState<string[]>([]);

  React.useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const root = $getRoot();
        const currentTools: string[] = [];

        // Traverse all nodes to find tool pills
        function traverse(node: any): void {
          if ($isToolPillNode(node)) {
            const toolName = node.getToolName();
            if (!currentTools.includes(toolName)) {
              currentTools.push(toolName);
            }
          }

          if (node.getChildren) {
            const children = node.getChildren();
            children.forEach(traverse);
          }
        }

        traverse(root);

        // Check for changes
        const added = currentTools.filter((tool) => !previousTools.includes(tool));
        const removed = previousTools.filter((tool) => !currentTools.includes(tool));

        if (added.length > 0 || removed.length > 0) {
          // Update callbacks
          if (onToolsChange && currentTools.length > 0) {
            onToolsChange(currentTools);
          }

          if (onToolsRemoved && removed.length > 0) {
            onToolsRemoved(removed);
          }

          // Update previous state
          setPreviousTools(currentTools);
        }
      });
    });
  }, [editor, onToolsChange, onToolsRemoved, previousTools]);

  return null;
}
