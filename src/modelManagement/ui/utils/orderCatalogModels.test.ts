import type { ModelInfo } from "@/modelManagement/types/catalog";
import { orderCatalogModels } from "./orderCatalogModels";

const model = (id: string, releaseDate?: string): ModelInfo => ({
  id,
  displayName: id,
  releaseDate,
});

const ids = (models: readonly ModelInfo[]): string[] => models.map((m) => m.id);

describe("orderCatalogModels", () => {
  it("floats checked models above unchecked, regardless of date", () => {
    const models = [
      model("a", "2025-01-01"), // unchecked, newest
      model("b", "2024-01-01"), // checked, older
      model("c", "2023-01-01"), // unchecked, oldest
    ];
    const result = orderCatalogModels(models, new Set(["b"]));
    expect(ids(result)).toEqual(["b", "a", "c"]);
  });

  it("orders newest release date first within a group", () => {
    const models = [
      model("old", "2024-03-01"),
      model("new", "2025-09-01"),
      model("mid", "2025-01-01"),
    ];
    const result = orderCatalogModels(models, new Set());
    expect(ids(result)).toEqual(["new", "mid", "old"]);
  });

  it("sinks undated and unparseable models to the bottom of their group", () => {
    const models = [model("undated"), model("dated", "2025-01-01"), model("garbage", "not-a-date")];
    const result = orderCatalogModels(models, new Set());
    expect(result[0].id).toBe("dated");
    expect(ids(result).slice(1).sort()).toEqual(["garbage", "undated"]);
  });

  it("floats custom ids above discovered within each selection group", () => {
    // Unchecked group only — proves custom-first applies regardless of date.
    const models = [
      model("catalog-new", "2025-09-01"),
      model("catalog-old", "2024-01-01"),
      model("custom-old", "2024-06-01"),
      model("custom-new", "2025-03-01"),
    ];
    const result = orderCatalogModels(models, new Set(), new Set(["custom-old", "custom-new"]));
    expect(ids(result)).toEqual(["custom-new", "custom-old", "catalog-new", "catalog-old"]);
  });

  it("applies custom-first within both checked and unchecked groups", () => {
    const models = [
      model("checked-catalog", "2025-01-01"),
      model("checked-custom", "2024-01-01"),
      model("unchecked-catalog", "2025-02-01"),
      model("unchecked-custom", "2024-02-01"),
    ];
    const result = orderCatalogModels(
      models,
      new Set(["checked-catalog", "checked-custom"]),
      new Set(["checked-custom", "unchecked-custom"])
    );
    expect(ids(result)).toEqual([
      "checked-custom",
      "checked-catalog",
      "unchecked-custom",
      "unchecked-catalog",
    ]);
  });

  it("does not mutate the input array", () => {
    const models = [model("a", "2024-01-01"), model("b", "2025-01-01")];
    const snapshot = ids(models);
    orderCatalogModels(models, new Set(["a"]));
    expect(ids(models)).toEqual(snapshot);
  });
});
