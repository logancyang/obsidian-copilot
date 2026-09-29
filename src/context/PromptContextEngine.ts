import { sha256 } from "@/utils/hash";
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

export class PromptContextEngine {
  private static instance: PromptContextEngine | undefined;
  private static readonly ENVELOPE_VERSION = 1;

  private constructor() {}

  static getInstance(): PromptContextEngine {
    if (!PromptContextEngine.instance) {
      PromptContextEngine.instance = new PromptContextEngine();
    }
    return PromptContextEngine.instance;
  }

  buildEnvelope(params: PromptContextBuildParams): PromptContextEnvelope {
    const layers: PromptContextLayer[] = PROMPT_LAYER_ORDER.map((layerId) =>
      this.buildLayer(layerId, params.layerSegments[layerId] ?? [])
    );

    const serializedText = this.serializeLayers(layers);
    const layerHashes = this.collectLayerHashes(layers);
    const combinedHash = this.hash(serializedText);

    const debugLabel =
      typeof params.metadata?.["debugLabel"] === "string"
        ? params.metadata["debugLabel"]
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

  private serializeLayers(layers: PromptContextLayer[]): string {
    return layers
      .map((layer) => layer.text)
      .filter((text) => text.length > 0)
      .join("\n\n");
  }

  private collectLayerHashes(layers: PromptContextLayer[]): Record<PromptLayerId, string> {
    return layers.reduce<Record<PromptLayerId, string>>(
      (acc, layer) => {
        acc[layer.id] = layer.hash;
        return acc;
      },
      {} as Record<PromptLayerId, string>
    );
  }

  private hash(value: string): string {
    return sha256(value || "");
  }

  private normalizeWhitespace(value: string): string {
    return value.replace(/\s+$/g, "").trim();
  }

  private collectWarnings(layers: PromptContextLayer[]): string[] {
    const warnings: string[] = [];

    layers.forEach((layer) => {
      if (!layer.text) {
        return;
      }
      const containsControlChars = layer.text.includes("\x00");
      if (containsControlChars) {
        warnings.push(`Layer ${layer.id} contains control characters and was normalized`);
      }
    });

    return warnings;
  }
}
