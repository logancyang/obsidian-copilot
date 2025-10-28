import { PromptContextEnvelope, PromptLayerSegment } from "@/context/PromptContextTypes";
import { logInfo } from "@/logger";

/**
 * Provider-agnostic message format used by LLM providers.
 * Maps to OpenAI/Anthropic message format.
 */
export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Configuration for layer-to-messages conversion.
 */
export interface ConversionOptions {
  /**
   * Whether to include L1 (System) as a separate system message.
   * Default: true
   */
  includeSystemMessage?: boolean;

  /**
   * Whether to merge L3+L5 into a single user message.
   * Default: true (most providers expect this)
   */
  mergeUserContent?: boolean;

  /**
   * Whether to log conversion details for debugging.
   * Default: false
   */
  debug?: boolean;
}

/**
 * LayerToMessagesConverter transforms PromptContextEnvelope layers into
 * provider-specific message arrays.
 *
 * This converter is model-agnostic and produces messages that work with
 * OpenAI, Anthropic, Google, and other providers following similar formats.
 */
export class LayerToMessagesConverter {
  /**
   * Convert an envelope to provider messages.
   *
   * @param envelope The prompt context envelope containing L1-L5 layers
   * @param options Conversion options
   * @returns Array of provider messages
   */
  static convert(
    envelope: PromptContextEnvelope,
    options: ConversionOptions = {}
  ): ProviderMessage[] {
    const { includeSystemMessage = true, mergeUserContent = true, debug = false } = options;

    const messages: ProviderMessage[] = [];

    // Find layers by ID
    const l1System = envelope.layers.find((l) => l.id === "L1_SYSTEM");
    const l2Previous = envelope.layers.find((l) => l.id === "L2_PREVIOUS");
    const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
    const l4Strip = envelope.layers.find((l) => l.id === "L4_STRIP");
    const l5User = envelope.layers.find((l) => l.id === "L5_USER");

    // Build stable prefix: L1 + L2 (cacheable system message)
    // L2 contains ALL context items ever seen (cumulative)
    if (includeSystemMessage && l1System && l1System.text) {
      const systemParts: string[] = [l1System.text];

      // Add L2 (cumulative context) if present
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

    // Handle conversation history from L4 if present
    // Note: L4 is currently deferred, so this is a placeholder for future use
    if (l4Strip && l4Strip.text) {
      // L4 would contain formatted conversation history
      // For now, we skip it and rely on ChainRunner's existing memory management
      if (debug) {
        logInfo("[LayerToMessagesConverter] L4 (Strip) found but skipped (using LangChain memory)");
      }
    }

    // Build user message: L3 (smart references/content) + L5
    // L3 intelligently references items already in L2 by ID, includes full content for new items
    if (mergeUserContent) {
      const userContentParts: string[] = [];

      // Process L3 using structured segments (not regex!)
      if (l3Turn && l3Turn.segments.length > 0 && l2Previous) {
        // Build set of item IDs already in L2 (cumulative context library)
        const l2ItemIds = new Set<string>(l2Previous.segments.map((seg) => seg.id));

        // Separate L3 segments into: items already in L2 vs. new items
        const referencedIds: string[] = [];
        const newSegments: PromptLayerSegment[] = [];

        for (const segment of l3Turn.segments) {
          if (l2ItemIds.has(segment.id)) {
            // Item already in L2, just reference by ID
            referencedIds.push(segment.id);
          } else {
            // Item not in L2, include full content
            newSegments.push(segment);
          }
        }

        // Build L3 content
        if (referencedIds.length > 0 || newSegments.length > 0) {
          const l3Parts: string[] = [];

          // Add references to items already in L2
          if (referencedIds.length > 0) {
            l3Parts.push(
              "Context attached to this message:\n" +
                referencedIds.map((id) => `- ${id}`).join("\n") +
                "\n\nFind them in the Context Library in the system prompt above."
            );
          }

          // Add full content for new items
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
        // No L2 or no segments, use text as-is (fallback for legacy or simple cases)
        userContentParts.push(l3Turn.text);
        if (debug) {
          logInfo("[LayerToMessagesConverter] Added L3 (all new context)");
        }
      }

      // Add separator before L5 if we have context
      if (userContentParts.length > 0 && l5User && l5User.text) {
        userContentParts.push("---\n\n[User query]:");
      }

      // Add L5 (user message)
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
      // Alternative: separate messages for each layer (rarely used)
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

  /**
   * Extract just the user content from an envelope (L3 smart references + L5).
   * L2 is part of the system message, so it's not included here.
   * L3 intelligently references items in L2 by ID, or includes full content for new items.
   *
   * @param envelope The prompt context envelope
   * @returns Merged user content string (smart context + user message)
   */
  static extractUserContent(envelope: PromptContextEnvelope): string {
    const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
    const l5User = envelope.layers.find((l) => l.id === "L5_USER");

    const parts: string[] = [];

    // L3 includes smart references/content
    if (l3Turn && l3Turn.text) {
      parts.push(l3Turn.text);
    }

    if (l5User && l5User.text) {
      parts.push(l5User.text);
    }

    return parts.join("\n\n");
  }

  /**
   * Extract the full context including L2 (L2+L3+L5).
   * This should only be used for special cases like multimodal image extraction
   * where you need access to ALL context including the cumulative library.
   *
   * @param envelope The prompt context envelope
   * @returns Merged content including all context
   */
  static extractFullContext(envelope: PromptContextEnvelope): string {
    const l2Previous = envelope.layers.find((l) => l.id === "L2_PREVIOUS");
    const l3Turn = envelope.layers.find((l) => l.id === "L3_TURN");
    const l5User = envelope.layers.find((l) => l.id === "L5_USER");

    const parts: string[] = [];
    if (l2Previous && l2Previous.text) parts.push(l2Previous.text);
    if (l3Turn && l3Turn.text) parts.push(l3Turn.text);
    if (l5User && l5User.text) parts.push(l5User.text);

    return parts.join("\n\n");
  }

  /**
   * Extract just the system message from an envelope (L1).
   *
   * @param envelope The prompt context envelope
   * @returns System message content or empty string if not present
   */
  static extractSystemMessage(envelope: PromptContextEnvelope): string {
    const l1System = envelope.layers.find((l) => l.id === "L1_SYSTEM");
    return l1System?.text || "";
  }

  /**
   * Get layer hashes for cache tracking.
   * Returns a map of layer IDs to their hashes.
   *
   * @param envelope The prompt context envelope
   * @returns Map of layer IDs to hashes
   */
  static getLayerHashes(envelope: PromptContextEnvelope): Record<string, string> {
    return envelope.layerHashes;
  }
}
