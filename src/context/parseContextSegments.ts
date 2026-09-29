import { PromptLayerSegment } from "@/context/PromptContextTypes";
import {
  CONTEXT_BLOCK_TYPES,
  extractSourceFromBlock,
  getSourceType,
} from "@/context/contextBlockRegistry";

export function parseContextIntoSegments(
  contextXml: string,
  stable: boolean
): PromptLayerSegment[] {
  if (!contextXml.trim()) {
    return [];
  }

  const segments: PromptLayerSegment[] = [];

  const registeredTags = CONTEXT_BLOCK_TYPES.map((bt) => bt.tag);
  const allTags = [...registeredTags, "prior_context"];
  const allBlocksRegex = new RegExp(`<(${allTags.join("|")})(\\s[^>]*)?>[\\s\\S]*?</\\1>`, "g");

  const tagIdCounts = new Map<string, number>();

  let match: RegExpExecArray | null;
  while ((match = allBlocksRegex.exec(contextXml)) !== null) {
    const block = match[0];
    const tag = match[1];

    if (tag === "prior_context") {
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
      const extractedId = extractSourceFromBlock(block, tag);
      let sourceId: string;
      if (extractedId) {
        sourceId = extractedId;
      } else {
        const count = (tagIdCounts.get(tag) || 0) + 1;
        tagIdCounts.set(tag, count);
        sourceId = count === 1 ? tag : `${tag}:${count}`;
      }
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
