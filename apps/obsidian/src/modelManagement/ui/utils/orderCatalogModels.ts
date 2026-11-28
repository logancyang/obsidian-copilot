import type { ModelInfo } from "@/modelManagement/types/catalog";

export function orderCatalogModels(
  models: readonly ModelInfo[],
  selected: ReadonlySet<string>,
  customIds?: ReadonlySet<string>
): readonly ModelInfo[] {
  const ts = (iso?: string): number => {
    if (!iso) return -Infinity;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...models].sort((a, b) => {
    const aSel = selected.has(a.id);
    const bSel = selected.has(b.id);
    if (aSel !== bSel) return aSel ? -1 : 1;
    if (customIds) {
      const aCustom = customIds.has(a.id);
      const bCustom = customIds.has(b.id);
      if (aCustom !== bCustom) return aCustom ? -1 : 1;
    }
    return ts(b.releaseDate) - ts(a.releaseDate);
  });
}
