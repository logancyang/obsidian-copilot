/**
 * Ordering for the catalog model picker (`ProviderCatalogList`): checked
 * models float to the top, and within each group the newest release date
 * comes first. Pure — no imports beyond the model type.
 */
import type { ModelInfo } from "@/modelManagement/types/catalog";

/**
 * Order catalog models for the picker: checked models first, then unchecked;
 * within each selection group, custom-added ids (when supplied) float above
 * discovered ones; within each remaining sub-group, newest `releaseDate`
 * first with undated (or unparseable) models last. Returns a new array;
 * `Array.sort` is stable for equal keys.
 */
export function orderCatalogModels(
  models: readonly ModelInfo[],
  selected: ReadonlySet<string>,
  customIds?: ReadonlySet<string>
): readonly ModelInfo[] {
  const ts = (iso?: string): number => {
    if (!iso) return -Infinity;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? -Infinity : t; // undated/unparseable sink to bottom
  };
  return [...models].sort((a, b) => {
    const aSel = selected.has(a.id);
    const bSel = selected.has(b.id);
    if (aSel !== bSel) return aSel ? -1 : 1; // checked group first
    if (customIds) {
      const aCustom = customIds.has(a.id);
      const bCustom = customIds.has(b.id);
      if (aCustom !== bCustom) return aCustom ? -1 : 1; // custom before discovered
    }
    return ts(b.releaseDate) - ts(a.releaseDate); // newest first
  });
}
