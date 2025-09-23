import React from "react";
import { $isToolPillNode } from "../pills/ToolPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";

/**
 * Props for the ToolPillSyncPlugin component
 */
interface ToolPillSyncPluginProps {
  /** Callback triggered when the list of tool pills changes */
  onToolsChange?: (tools: string[]) => void;
  /** Callback triggered when tool pills are removed from the editor */
  onToolsRemoved?: (removedTools: string[]) => void;
}

/**
 * Configuration for tool pill synchronization
 */
const toolPillConfig: PillSyncConfig<string> = {
  isPillNode: $isToolPillNode,
  extractData: (node: any) => node.getToolName(),
};

/**
 * Lexical plugin that monitors tool pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to tool pills to keep external state in sync with editor content.
 */
export function ToolPillSyncPlugin({ onToolsChange, onToolsRemoved }: ToolPillSyncPluginProps) {
  return (
    <GenericPillSyncPlugin
      config={toolPillConfig}
      onChange={onToolsChange}
      onRemoved={onToolsRemoved}
    />
  );
}
