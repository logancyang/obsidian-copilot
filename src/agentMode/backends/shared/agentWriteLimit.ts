// A model step stops at the 16,384-token output limit, but the provider still reports a write cut
// off there as a finished tool call, so OpenCode runs it and saves an empty or partial note.
// 40,000 bytes is the largest call the densest measured text (about 0.37 tokens per byte) fits in
// one step; the word hint sits under it so a model that follows the prompt is never rejected.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/641
export const AGENT_WRITE_MAX_BYTES = 40_000;
export const AGENT_WRITE_HINT_WORDS = 5_000;
