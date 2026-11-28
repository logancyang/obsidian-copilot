export const PROMPT_LAYER_ORDER = [
  "L1_SYSTEM",
  "L2_PREVIOUS",
  "L3_TURN",
  "L4_STRIP",
  "L5_USER",
] as const;

export type PromptLayerId = (typeof PROMPT_LAYER_ORDER)[number];

export const PROMPT_LAYER_LABELS: Record<PromptLayerId, string> = {
  L1_SYSTEM: "System Instructions",
  L2_PREVIOUS: "Previous Turn Context",
  L3_TURN: "Current Turn Context",
  L4_STRIP: "Conversation Strip",
  L5_USER: "User Message",
};

export type PromptContextMetadata = Record<string, unknown>;

export interface PromptLayerSegment {
  id: string;
  content: string;
  stable: boolean;
  metadata?: PromptContextMetadata;
}

export interface PromptContextLayer {
  id: PromptLayerId;
  label: string;
  text: string;
  stable: boolean;
  segments: PromptLayerSegment[];
  hash: string;
  metadata?: PromptContextMetadata;
}

export interface PromptContextEnvelope {
  version: number;
  conversationId: string | null;
  messageId: string | null;
  layers: PromptContextLayer[];
  serializedText: string;
  layerHashes: Record<PromptLayerId, string>;
  combinedHash: string;
  debug?: {
    warnings: string[];
  };
}

export interface PromptContextBuildParams {
  conversationId: string | null;
  messageId: string | null;
  layerSegments: Partial<Record<PromptLayerId, PromptLayerSegment[]>>;
  metadata?: PromptContextMetadata;
}
