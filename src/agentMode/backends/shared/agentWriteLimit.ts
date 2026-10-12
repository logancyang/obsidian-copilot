// A model step stops at the 16,384-token output limit, but the provider still reports a write cut
// off there as a finished tool call, so OpenCode runs it and saves an empty or partial note.
// 40,000 bytes is the largest call the densest measured text (about 0.37 tokens per byte) fits in
// one step. The word hint keeps English and most Latin-script text under it; 5,000 words of Turkish,
// Korean, Arabic or Russian is 43-63 KB, so there a model can be refused once before it splits.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/641
export const AGENT_WRITE_MAX_BYTES = 40_000;
export const AGENT_WRITE_HINT_WORDS = 5_000;
