export interface ModelContextLimits {
  contextWindow?: number;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}
export function contextTokens(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}
