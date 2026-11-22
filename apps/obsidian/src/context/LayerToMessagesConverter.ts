import { PromptContextEnvelope, PromptLayerSegment } from "@/context/PromptContextTypes";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class LayerToMessagesConverter {
  static convert(envelope: PromptContextEnvelope): ProviderMessage[] {
    const messages: ProviderMessage[] = [];

    const l1System = envelope.layers.find((l) => l.id === "L1_SYSTEM");
    const l2Previous = envelope.layers.find((l) => l.id === "L2_PREVIOUS");
    const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
    const l5User = envelope.layers.find((l) => l.id === "L5_USER");

    if (l1System && l1System.text) {
      const systemParts: string[] = [l1System.text];

      if (l2Previous && l2Previous.text) {
        systemParts.push(
          "\n## Context Library\n\nThe following notes are available for reference:\n\n" +
            l2Previous.text
        );
      }

      messages.push({
        role: "system",
        content: systemParts.join("\n"),
      });
    }

    const userContentParts: string[] = [];

    if (l3Turn && l3Turn.segments.length > 0 && l2Previous) {
      const l2ItemIds = new Set<string>(l2Previous.segments.map((seg) => seg.id));

      const referencedIds: string[] = [];
      const newSegments: PromptLayerSegment[] = [];

      for (const segment of l3Turn.segments) {
        if (l2ItemIds.has(segment.id)) {
          referencedIds.push(segment.id);
        } else {
          newSegments.push(segment);
        }
      }

      if (referencedIds.length > 0 || newSegments.length > 0) {
        const l3Parts: string[] = [];

        if (referencedIds.length > 0) {
          l3Parts.push(
            "Context attached to this message:\n" +
              referencedIds.map((id) => `- ${id}`).join("\n") +
              "\n\nFind them in the Context Library in the system prompt above."
          );
        }

        if (newSegments.length > 0) {
          l3Parts.push(newSegments.map((seg) => seg.content).join("\n"));
        }

        userContentParts.push(l3Parts.join("\n\n"));
      }
    } else if (l3Turn && l3Turn.text) {
      userContentParts.push(l3Turn.text);
    }

    if (userContentParts.length > 0 && l5User && l5User.text) {
      userContentParts.push("---\n\n[User query]:");
    }

    if (l5User && l5User.text) {
      userContentParts.push(l5User.text);
    }

    if (userContentParts.length > 0) {
      messages.push({
        role: "user",
        content: userContentParts.join("\n\n"),
      });
    }

    return messages;
  }
}
