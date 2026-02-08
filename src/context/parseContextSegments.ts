import { PromptLayerSegment } from "@/context/PromptContextTypes";
import {
  CONTEXT_BLOCK_TYPES,
  extractSourceFromBlock,
  getSourceType,
} from "@/context/contextBlockRegistry";

/**
 * Parse context XML string into individual segments (one per context item).
 * Uses the contextBlockRegistry to dynamically match ALL registered block types,
 * plus <prior_context> blocks (compaction artifacts from L2).
 */
export function parseContextIntoSegments(
  contextXml: string,
  stable: boolean
): PromptLayerSegment[] {
  if (!contextXml.trim()) {
    return [];
  }

  const segments: PromptLayerSegment[] = [];

  // Build regex dynamically from all registered block types + prior_context
  const registeredTags = CONTEXT_BLOCK_TYPES.map((bt) => bt.tag);
  const allTags = [...registeredTags, "prior_context"];
  const allBlocksRegex = new RegExp(`<(${allTags.join("|")})(\\s[^>]*)?>[\\s\\S]*?</\\1>`, "g");

  let match: RegExpExecArray | null;
  while ((match = allBlocksRegex.exec(contextXml)) !== null) {
    const block = match[0];
    const tag = match[1];

    if (tag === "prior_context") {
      // Compacted blocks have source in attribute: <prior_context source="path" type="note">
      const sourceMatch = /source="([^"]+)"/.exec(block);
      const source = sourceMatch?.[1] ?? "prior_context";
      segments.push({
        id: source,
        content: block,
        stable,
        metadata: {
          source: "previous_turns_compacted",
          notePath: source,
        },
      });
    } else {
      // Use registry to extract the source identifier
      const sourceId = extractSourceFromBlock(block, tag) || tag;
      const isNote = getSourceType(tag) === "note";
      segments.push({
        id: sourceId,
        content: block,
        stable,
        metadata: {
          source: stable ? "previous_turns" : "current_turn",
          ...(isNote ? { notePath: sourceId } : {}),
        },
      });
    }
  }

  return segments;
}
