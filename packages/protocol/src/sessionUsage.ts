export interface SessionUsage {
  usedTokens: number;
  contextWindow?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  updatedAt: number;
}
