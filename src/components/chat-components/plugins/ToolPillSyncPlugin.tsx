import React from "react";
import { $isToolPillNode, ToolPillNode } from "@/components/chat-components/pills/ToolPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";
import type { LexicalNode } from "lexical";

interface ToolPillSyncPluginProps {
  onToolsChange?: (tools: string[]) => void;
}

const toolPillConfig: PillSyncConfig<string> = {
  isPillNode: $isToolPillNode,
  extractData: (node: LexicalNode) => (node as ToolPillNode).getToolName(),
};

export function ToolPillSyncPlugin({ onToolsChange }: ToolPillSyncPluginProps) {
  return <GenericPillSyncPlugin config={toolPillConfig} onChange={onToolsChange} />;
}
