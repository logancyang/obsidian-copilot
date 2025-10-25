import { PromptContextEnvelope } from "@/context/PromptContextTypes";
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

    // Add L1 (System) as system message if present
    if (includeSystemMessage && l1System && l1System.text) {
      messages.push({
        role: "system",
        content: l1System.text,
      });
      if (debug) {
        logInfo("[LayerToMessagesConverter] Added L1 (System) message");
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

    // Build user message content
    if (mergeUserContent) {
      // Most common case: merge L2, L3, L5 into a single user message
      const userContentParts: string[] = [];

      if (l2Previous && l2Previous.text) {
        userContentParts.push(l2Previous.text);
        if (debug) {
          logInfo("[LayerToMessagesConverter] Added L2 (Previous) to user message");
        }
      }

      if (l3Turn && l3Turn.text) {
        userContentParts.push(l3Turn.text);
        if (debug) {
          logInfo("[LayerToMessagesConverter] Added L3 (Turn) to user message");
        }
      }

      if (l5User && l5User.text) {
        userContentParts.push(l5User.text);
        if (debug) {
          logInfo("[LayerToMessagesConverter] Added L5 (User) to user message");
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
      // This can be useful for providers with special handling for previous context
      if (l2Previous && l2Previous.text) {
        messages.push({ role: "user", content: l2Previous.text });
      }
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
   * Extract just the user content from an envelope (L2+L3+L5 merged).
   * This is useful when you need the full context without the system message.
   *
   * @param envelope The prompt context envelope
   * @returns Merged user content string
   */
  static extractUserContent(envelope: PromptContextEnvelope): string {
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
