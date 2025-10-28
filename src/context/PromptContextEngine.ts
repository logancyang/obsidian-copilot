import { SHA256 } from "crypto-js";
import { logInfo } from "@/logger";
import {
  PROMPT_LAYER_LABELS,
  PROMPT_LAYER_ORDER,
  PromptContextBuildParams,
  PromptContextEnvelope,
  PromptContextLayer,
  PromptLayerId,
  PromptLayerSegment,
} from "@/context/PromptContextTypes";

/**
 * PromptContextEngine centralizes the construction of Layered Prefix prompts.
 * It emits diagnostics so we can validate the canonical rendering before
 * swapping downstream consumers to the new payloads.
 */
export class PromptContextEngine {
  private static instance: PromptContextEngine | undefined;
  private static readonly ENVELOPE_VERSION = 1;

  private constructor() {}

  /**
   * Singleton accessor so shared services (ContextManager, persistence, etc.)
   * can reuse the same engine without wiring it through constructors.
   */
  static getInstance(): PromptContextEngine {
    if (!PromptContextEngine.instance) {
      PromptContextEngine.instance = new PromptContextEngine();
    }
    return PromptContextEngine.instance;
  }

  /**
   * Build a prompt context envelope for the provided segments. The resulting
   * structure can be stored alongside messages and later transformed into
   * provider-specific message arrays.
   */
  buildEnvelope(params: PromptContextBuildParams): PromptContextEnvelope {
    const layers: PromptContextLayer[] = PROMPT_LAYER_ORDER.map((layerId) =>
      this.buildLayer(layerId, params.layerSegments[layerId] ?? [])
    );

    const serializedText = this.serializeLayers(layers);
    const layerHashes = this.collectLayerHashes(layers);
    const combinedHash = this.hash(serializedText);

    const debugLabel =
      typeof params.metadata?.["debugLabel"] === "string"
        ? (params.metadata["debugLabel"] as string)
        : undefined;

    if (debugLabel) {
      logInfo(`[PromptContextEngine] Built envelope for ${debugLabel}`, layerHashes);
    }

    return {
      version: PromptContextEngine.ENVELOPE_VERSION,
      conversationId: params.conversationId,
      messageId: params.messageId,
      layers,
      serializedText,
      layerHashes,
      combinedHash,
      debug: {
        warnings: this.collectWarnings(layers),
      },
    };
  }

  /**
   * Render the supplied layer segments into a canonical block of text while
   * capturing per-layer hashes and stability hints.
   */
  private buildLayer(layerId: PromptLayerId, segments: PromptLayerSegment[]): PromptContextLayer {
    const sanitizedSegments = segments.map((segment, index) => ({
      ...segment,
      id: segment.id || `${layerId}-segment-${index}`,
      content: this.normalizeWhitespace(segment.content),
      stable: segment.stable ?? true,
    }));

    const text = this.normalizeWhitespace(
      sanitizedSegments
        .map((segment) => segment.content)
        .filter(Boolean)
        .join("\n\n")
    );

    return {
      id: layerId,
      label: PROMPT_LAYER_LABELS[layerId],
      text,
      segments: sanitizedSegments,
      stable: sanitizedSegments.every((segment) => segment.stable),
      metadata: sanitizedSegments.length === 1 ? sanitizedSegments[0].metadata : undefined,
      hash: this.hash(text),
    };
  }

  /**
   * Combine the rendered layers into a legacy-compatible string.
   * Uses clean double-newline separation between layers.
   */
  private serializeLayers(layers: PromptContextLayer[]): string {
    return layers
      .map((layer) => layer.text)
      .filter((text) => text.length > 0)
      .join("\n\n");
  }

  /**
   * Collect the precomputed hash for every layer so callers can quickly compare
   * stability without re-hashing the text.
   */
  private collectLayerHashes(layers: PromptContextLayer[]): Record<PromptLayerId, string> {
    return layers.reduce<Record<PromptLayerId, string>>(
      (acc, layer) => {
        acc[layer.id] = layer.hash;
        return acc;
      },
      {} as Record<PromptLayerId, string>
    );
  }

  /**
   * Compute a SHA-256 hash for the supplied value.
   * Uses crypto-js for mobile compatibility (no Node.js crypto).
   */
  private hash(value: string): string {
    return SHA256(value || "").toString();
  }

  /**
   * Normalize whitespace so hashed content remains stable regardless of how the
   * upstream caller formatted the raw text.
   */
  private normalizeWhitespace(value: string): string {
    return value.replace(/\s+$/g, "").trim();
  }

  /**
   * Gather lightweight warnings for debugging. This keeps the envelope self
   * describing without introducing an external logging dependency.
   */
  private collectWarnings(layers: PromptContextLayer[]): string[] {
    const warnings: string[] = [];

    layers.forEach((layer) => {
      if (!layer.text) {
        return;
      }
      // Check for null bytes (control character)
      const containsControlChars = layer.text.includes("\x00");
      if (containsControlChars) {
        warnings.push(`Layer ${layer.id} contains control characters and was normalized`);
      }
    });

    return warnings;
  }
}
