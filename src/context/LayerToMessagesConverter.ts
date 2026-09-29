import { PromptContextEnvelope, PromptLayerSegment } from "@/context/PromptContextTypes";
import { logInfo } from "@/logger";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ConversionOptions {
  includeSystemMessage?: boolean;

  mergeUserContent?: boolean;

  debug?: boolean;
}

export class LayerToMessagesConverter {
  static convert(
    envelope: PromptContextEnvelope,
    options: ConversionOptions = {}
  ): ProviderMessage[] {
    const { includeSystemMessage = true, mergeUserContent = true, debug = false } = options;

    const messages: ProviderMessage[] = [];

    const l1System = envelope.layers.find((l) => l.id === "L1_SYSTEM");
    const l2Previous = envelope.layers.find((l) => l.id === "L2_PREVIOUS");
    const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
    const l4Strip = envelope.layers.find((l) => l.id === "L4_STRIP");
    const l5User = envelope.layers.find((l) => l.id === "L5_USER");

    if (includeSystemMessage && l1System && l1System.text) {
      const systemParts: string[] = [l1System.text];

      if (l2Previous && l2Previous.text) {
        systemParts.push(
          "\n## Context Library\n\nThe following notes are available for reference:\n\n" +
            l2Previous.text
        );
        if (debug) {
          logInfo("[LayerToMessagesConverter] Added L2 (cumulative context) to system");
        }
      }

      messages.push({
        role: "system",
        content: systemParts.join("\n"),
      });
      if (debug) {
        logInfo("[LayerToMessagesConverter] Added L1 (System) + L2 (Cumulative) as stable prefix");
      }
    }

    if (l4Strip && l4Strip.text) {
      if (debug) {
        logInfo("[LayerToMessagesConverter] L4 (Strip) found but skipped (using LangChain memory)");
      }
    }

    if (mergeUserContent) {
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
          if (debug) {
            logInfo(
              `[LayerToMessagesConverter] Added L3: ${referencedIds.length} references, ${newSegments.length} new items`
            );
          }
        }
      } else if (l3Turn && l3Turn.text) {
        userContentParts.push(l3Turn.text);
        if (debug) {
          logInfo("[LayerToMessagesConverter] Added L3 (all new context)");
        }
      }

      if (userContentParts.length > 0 && l5User && l5User.text) {
        userContentParts.push("---\n\n[User query]:");
      }

      if (l5User && l5User.text) {
        userContentParts.push(l5User.text);
        if (debug) {
          logInfo("[LayerToMessagesConverter] Added L5 (user message)");
        }
      }

      if (userContentParts.length > 0) {
        messages.push({
          role: "user",
          content: userContentParts.join("\n\n"),
        });
      }
    } else {
      if (l3Turn && l3Turn.text) {
        messages.push({ role: "user", content: l3Turn.text });
      }
      if (l5User && l5User.text) {
        messages.push({ role: "user", content: l5User.text });
      }
    }

    if (debug) {
      logInfo(`[LayerToMessagesConverter] Converted envelope to ${messages.length} messages`);
      messages.forEach((msg, idx) => {
        const preview = msg.content.substring(0, 100);
        logInfo(`  Message ${idx + 1} [${msg.role}]: ${preview}...`);
      });
    }

    return messages;
  }
}
