/**
 * Prompt context types define the shape of the upcoming Layered Prefix (L1-L5)
 * prompt assembly pipeline. These types are intentionally provider-agnostic so
 * the `PromptContextEngine` can emit deterministic layers regardless of which
 * model eventually consumes the request.
 */

/**
 * Ordered list of layer identifiers. These map directly to the Layered Prefix
 * nomenclature in the context engineering spec.
 */
export const PROMPT_LAYER_ORDER = [
  "L1_SYSTEM",
  "L2_PREVIOUS",
  "L3_TURN",
  "L4_STRIP",
  "L5_USER",
] as const;

export type PromptLayerId = (typeof PROMPT_LAYER_ORDER)[number];

/**
 * Human-friendly labels for each layer. Keeping this centralized ensures
 * tooling and debugging views remain consistent.
 */
export const PROMPT_LAYER_LABELS: Record<PromptLayerId, string> = {
  L1_SYSTEM: "System Instructions",
  L2_PREVIOUS: "Previous Turn Context",
  L3_TURN: "Current Turn Context",
  L4_STRIP: "Conversation Strip",
  L5_USER: "User Message",
};

/**
 * Metadata attached to layer entries. Using a plain record keeps the type open
 * for provider-specific hints (cache TTLs, breakpoints) without requiring any
 * provider-specific imports.
 */
export type PromptContextMetadata = Record<string, unknown>;

/**
 * Smallest unit of content inserted into a layer (for example, one note, tool
 * output, or summary chunk). Segments allow the engine to emit structured
 * metadata per attachment while still producing a single layer string.
 */
export interface PromptLayerSegment {
  /** Stable identifier (path, note id, etc.) */
  id: string;
  /** Render-ready text for the segment */
  content: string;
  /** Whether this segment is expected to remain stable turn-to-turn */
  stable: boolean;
  /** Optional metadata for cache hints or UI inspection */
  metadata?: PromptContextMetadata;
}

/**
 * Fully rendered layer including the concatenated text, metadata, and
 * deterministic hash. Layers are emitted in the order defined by
 * `PROMPT_LAYER_ORDER`.
 */
export interface PromptContextLayer {
  id: PromptLayerId;
  label: string;
  text: string;
  stable: boolean;
  segments: PromptLayerSegment[];
  hash: string;
  metadata?: PromptContextMetadata;
}

/**
 * The prompt context envelope returned by the engine. It contains the rendered
 * layers and additional bookkeeping so downstream components (persistence,
 * providers, debug tooling) can reason about cache stability.
 */
export interface PromptContextEnvelope {
  /** Versioned so stored envelopes can be migrated in the future */
  version: number;
  /** Optional chat/conversation identifier for diagnostics */
  conversationId: string | null;
  /** Active message identifier (user turn) owning this envelope */
  messageId: string | null;
  /** Layer payloads in deterministic order */
  layers: PromptContextLayer[];
  /** Legacy concatenated prompt for backward-compatible consumers */
  serializedText: string;
  /** Hash per layer for cache tracking */
  layerHashes: Record<PromptLayerId, string>;
  /** Overall hash of serializedText (helpful for persistence) */
  combinedHash: string;
  /** Optional debugging details */
  debug?: {
    warnings: string[];
  };
}

/**
 * Parameters supplied when building a new envelope.
 */
export interface PromptContextBuildParams {
  conversationId: string | null;
  messageId: string | null;
  /**
   * Map of input segments per layer. Layers omitted from this map will default
   * to an empty string in the final envelope.
   */
  layerSegments: Partial<Record<PromptLayerId, PromptLayerSegment[]>>;
  /** Optional metadata recorded at the envelope level */
  metadata?: PromptContextMetadata;
}
