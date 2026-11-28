const SPECIAL_TOKEN_PATTERNS: string[] = [
  "<|im_end|>",
  "<|im_start|>",
  "<|eot_id|>",
  "<|start_header_id|>",
  "<|end_header_id|>",
  "<end_of_turn>",
  "<start_of_turn>",
  "<|end|>",
  "<|assistant|>",
  "<|user|>",
  "<|system|>",
  "</s>",
  "[INST]",
  "[/INST]",
  "<|endoftext|>",
  "<|end\u2581of\u2581sentence|>",
  "<|END_OF_TURN_TOKEN|>",
  "<|START_OF_TURN_TOKEN|>",
];

const SPECIAL_TOKENS_REGEX: RegExp = new RegExp(
  SPECIAL_TOKEN_PATTERNS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "g"
);

export function stripSpecialTokens(text: string): string {
  return text.replace(SPECIAL_TOKENS_REGEX, "");
}
