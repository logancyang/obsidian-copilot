/**
 * Strips known chat template control tokens that local model servers (LM Studio, Ollama)
 * sometimes leak into visible responses. These tokens are part of the model's internal
 * chat template and should never appear in user-visible output.
 *
 * Token families covered:
 * - ChatML: <|im_end|>, <|im_start|>
 * - Llama 3: <|eot_id|>, <|start_header_id|>, <|end_header_id|>
 * - Gemma: <end_of_turn>, <start_of_turn>
 * - Phi: <|end|>, <|assistant|>, <|user|>, <|system|>
 * - Mistral/Generic: </s>, [INST], [/INST]
 * - Qwen: <|endoftext|>
 * - DeepSeek: <|end▁of▁sentence|>
 * - Command R: <|END_OF_TURN_TOKEN|>, <|START_OF_TURN_TOKEN|>
 */

/** Known special tokens that must never appear in user-visible output. */
const SPECIAL_TOKEN_PATTERNS: string[] = [
  // ChatML
  "<|im_end|>",
  "<|im_start|>",
  // Llama 3
  "<|eot_id|>",
  "<|start_header_id|>",
  "<|end_header_id|>",
  // Gemma
  "<end_of_turn>",
  "<start_of_turn>",
  // Phi
  "<|end|>",
  "<|assistant|>",
  "<|user|>",
  "<|system|>",
  // Mistral/Generic (NOT <s> — can appear in normal text)
  "</s>",
  "[INST]",
  "[/INST]",
  // Qwen
  "<|endoftext|>",
  // DeepSeek (uses Unicode U+2581 LOWER ONE EIGHTH BLOCK for underscores)
  "<|end\u2581of\u2581sentence|>",
  // Command R
  "<|END_OF_TURN_TOKEN|>",
  "<|START_OF_TURN_TOKEN|>",
];

/**
 * Pre-compiled regex built from all known special token patterns.
 * Each token is escaped so that regex metacharacters are treated literally.
 * The `g` flag ensures all occurrences in a chunk are removed in one pass.
 */
const SPECIAL_TOKENS_REGEX: RegExp = new RegExp(
  SPECIAL_TOKEN_PATTERNS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);

/**
 * Strips all known chat template control tokens from the provided text.
 *
 * This is a zero-cost operation when the input contains no special tokens
 * (the regex engine scans without allocating a new string).
 *
 * @param text - Raw text chunk from a local LLM response stream.
 * @returns The text with all known special tokens removed.
 */
export function stripSpecialTokens(text: string): string {
  return text.replace(SPECIAL_TOKENS_REGEX, "");
}
