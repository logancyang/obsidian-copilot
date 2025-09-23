import React from "react";
import { $isTagPillNode } from "../pills/TagPillNode";
import { GenericPillSyncPlugin, PillSyncConfig } from "./GenericPillSyncPlugin";

/**
 * Props for the TagPillSyncPlugin component
 */
interface TagPillSyncPluginProps {
  /** Callback triggered when the list of tag pills changes */
  onTagsChange?: (tags: string[]) => void;
  /** Callback triggered when tag pills are removed from the editor */
  onTagsRemoved?: (removedTags: string[]) => void;
}

/**
 * Configuration for tag pill synchronization
 */
const tagPillConfig: PillSyncConfig<string> = {
  isPillNode: $isTagPillNode,
  extractData: (node: any) => node.getTagName(),
};

/**
 * Lexical plugin that monitors tag pill nodes in the editor and syncs
 * their state with parent components. Tracks additions, removals, and
 * changes to tag pills to keep external state in sync with editor content.
 */
export function TagPillSyncPlugin({ onTagsChange, onTagsRemoved }: TagPillSyncPluginProps) {
  return (
    <GenericPillSyncPlugin
      config={tagPillConfig}
      onChange={onTagsChange}
      onRemoved={onTagsRemoved}
    />
  );
}
