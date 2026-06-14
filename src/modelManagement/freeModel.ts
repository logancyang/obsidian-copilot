import type { ModelInfo } from "./types/catalog";

/**
 * A model is "free" when the catalog reports zero input *and* output cost.
 * Returns `false` when cost is unknown — we only flag a positive free signal,
 * never missing data.
 */
export function isFreeModelCost(cost: ModelInfo["cost"]): boolean {
  return cost?.input === 0 && cost?.output === 0;
}
