/**
 * Tests for `ConfiguredModelRegistry`.
 *
 * Real settings store via `resetSettings` / `setSettings`. No keychain
 * or Obsidian APIs are touched.
 */

import { getSettings, resetSettings } from "@/settings/model";

import type { ModelInfo } from "@/modelManagement/types/catalog";

import { ConfiguredModelRegistry } from "./ConfiguredModelRegistry";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const PROVIDER_A = "provider-a";
const PROVIDER_B = "provider-b";

function info(id: string, displayName = id): ModelInfo {
  return { id, displayName };
}

describe("ConfiguredModelRegistry", () => {
  let registry: ConfiguredModelRegistry;

  beforeEach(() => {
    resetSettings();
    registry = new ConfiguredModelRegistry();
  });

  it("add() mints id, stamps configuredAt, appends row", async () => {
    const before = Date.now();
    const id = await registry.add({
      providerId: PROVIDER_A,
      info: info("claude-sonnet-4-5", "Claude Sonnet 4.5"),
    });
    expect(typeof id).toBe("string");
    const row = registry.get(id)!;
    expect(row.providerId).toBe(PROVIDER_A);
    expect(row.info.id).toBe("claude-sonnet-4-5");
    expect(row.configuredAt).toBeGreaterThanOrEqual(before);
  });

  it("add() enforces (providerId, info.id) uniqueness", async () => {
    await registry.add({ providerId: PROVIDER_A, info: info("m1") });
    await expect(
      registry.add({ providerId: PROVIDER_A, info: info("m1", "different label") })
    ).rejects.toThrow(/already configured/);
    // Same wire id under a different provider is allowed.
    await expect(registry.add({ providerId: PROVIDER_B, info: info("m1") })).resolves.toBeDefined();
  });

  it("update() merges info patch and rejects unknown id", async () => {
    const id = await registry.add({
      providerId: PROVIDER_A,
      info: info("m1", "Original"),
    });
    await registry.update(id, { info: { displayName: "Renamed" } });
    expect(registry.get(id)!.info.displayName).toBe("Renamed");
    // Wire id unchanged.
    expect(registry.get(id)!.info.id).toBe("m1");

    await expect(registry.update("nope", { info: { displayName: "x" } })).rejects.toThrow(
      /unknown/
    );
  });

  it("remove() drops the row; idempotent for unknown id", async () => {
    const id = await registry.add({ providerId: PROVIDER_A, info: info("m1") });
    await registry.remove(id);
    expect(registry.get(id)).toBeUndefined();
    // Idempotent: removing the same id twice is a no-op.
    await expect(registry.remove(id)).resolves.toBeUndefined();
  });

  it("removeByProvider() only touches rows under the target provider", async () => {
    const a1 = await registry.add({ providerId: PROVIDER_A, info: info("m1") });
    const a2 = await registry.add({ providerId: PROVIDER_A, info: info("m2") });
    const b1 = await registry.add({ providerId: PROVIDER_B, info: info("m1") });
    await registry.removeByProvider(PROVIDER_A);
    expect(registry.get(a1)).toBeUndefined();
    expect(registry.get(a2)).toBeUndefined();
    expect(registry.get(b1)).toBeDefined();
  });

  it("listByProvider() returns stable references when settings unchanged", async () => {
    await registry.add({ providerId: PROVIDER_A, info: info("m1") });
    await registry.add({ providerId: PROVIDER_A, info: info("m2") });
    const r1 = registry.listByProvider(PROVIDER_A);
    const r2 = registry.listByProvider(PROVIDER_A);
    expect(r1).toBe(r2);
    expect(r1.length).toBe(2);

    // An empty filtered view returns the shared empty array.
    const e1 = registry.listByProvider(PROVIDER_B);
    const e2 = registry.listByProvider(PROVIDER_B);
    expect(e1).toBe(e2);
    expect(e1.length).toBe(0);
  });

  it("list() reuses a stable empty reference when no rows are configured", () => {
    const empty1 = registry.list();
    const empty2 = registry.list();
    expect(empty1).toBe(empty2);
    expect(empty1.length).toBe(0);
  });

  it("getByWireId() resolves under the right provider only", async () => {
    const a1 = await registry.add({ providerId: PROVIDER_A, info: info("m1") });
    await registry.add({ providerId: PROVIDER_B, info: info("m1") });
    expect(registry.getByWireId(PROVIDER_A, "m1")?.configuredModelId).toBe(a1);
    expect(registry.getByWireId(PROVIDER_A, "missing")).toBeUndefined();
  });

  it("bulkSet() preserves configuredModelId for existing (providerId, info.id) matches", async () => {
    const reusedInfo = info("m1", "First");
    const m1Id = await registry.add({ providerId: PROVIDER_A, info: reusedInfo });
    const m2Id = await registry.add({ providerId: PROVIDER_A, info: info("m2", "Second") });
    const m1Row = registry.get(m1Id)!;
    const m2Row = registry.get(m2Id)!;
    const m1ConfiguredAt = m1Row.configuredAt;

    // Re-set with m1 reused (same info object), m2 dropped, m3 added.
    const result = await registry.bulkSet(PROVIDER_A, [reusedInfo, info("m3", "Third")]);

    // m1 preserved -> same id; m3 minted -> new id.
    expect(result[0]).toBe(m1Id);
    expect(result[1]).not.toBe(m2Id);
    expect(registry.get(m2Id)).toBeUndefined();
    // Same `info` object passed back -> row reference reused.
    expect(registry.get(m1Id)).toBe(m1Row);
    expect(registry.get(m1Id)!.configuredAt).toBe(m1ConfiguredAt);
    // Sanity: untouched reference for m2 is no longer in the list.
    expect(registry.list()).not.toContain(m2Row);
  });

  it("bulkSet() refreshes info for reused rows while keeping configuredModelId stable", async () => {
    const m1Id = await registry.add({ providerId: PROVIDER_A, info: info("m1", "Old name") });
    const m1ConfiguredAt = registry.get(m1Id)!.configuredAt;

    // Caller passes a fresh `info` with updated displayName (e.g. catalog refresh).
    const result = await registry.bulkSet(PROVIDER_A, [info("m1", "New name")]);

    // configuredModelId + configuredAt preserved.
    expect(result[0]).toBe(m1Id);
    expect(registry.get(m1Id)!.configuredAt).toBe(m1ConfiguredAt);
    // But the refreshed info lands.
    expect(registry.get(m1Id)!.info.displayName).toBe("New name");
  });

  it("bulkSet() reuses the row reference when the fresh info is structurally equal", async () => {
    const m1Id = await registry.add({ providerId: PROVIDER_A, info: info("m1", "Same name") });
    const m1Row = registry.get(m1Id)!;

    // Simulate a catalog refresh: caller builds a fresh `info` object
    // with byte-identical content but a different reference. The row
    // reference must NOT churn — downstream React/Jotai memoization
    // counts on row identity remaining stable for no-op refreshes.
    const result = await registry.bulkSet(PROVIDER_A, [info("m1", "Same name")]);

    expect(result[0]).toBe(m1Id);
    expect(registry.get(m1Id)).toBe(m1Row);
  });

  it("bulkSet() silently dedupes duplicate info.id entries in the input", async () => {
    // Two distinct info objects with the same wire id — must collapse to
    // one row to preserve the (providerId, info.id) uniqueness invariant
    // that `add()` enforces.
    const result = await registry.bulkSet(PROVIDER_A, [info("dup"), info("dup", "shadowed")]);
    expect(result).toHaveLength(1);
    const rows = registry.listByProvider(PROVIDER_A);
    expect(rows).toHaveLength(1);
    expect(rows[0].configuredModelId).toBe(result[0]);
    // First occurrence wins; later duplicates are dropped.
    expect(rows[0].info.displayName).toBe("dup");
  });

  it("bulkSet() does not touch rows belonging to other providers", async () => {
    const a1 = await registry.add({ providerId: PROVIDER_A, info: info("m1") });
    const b1 = await registry.add({ providerId: PROVIDER_B, info: info("m1") });
    await registry.bulkSet(PROVIDER_A, [info("m1"), info("m2")]);
    // Provider B's row untouched.
    expect(registry.get(b1)).toBeDefined();
    // Provider A's m1 reused.
    expect(registry.getByWireId(PROVIDER_A, "m1")?.configuredModelId).toBe(a1);
  });

  it("settings reflect mutations atomically", async () => {
    const id = await registry.add({ providerId: PROVIDER_A, info: info("m1") });
    expect(getSettings().configuredModels.find((m) => m.configuredModelId === id)).toBeDefined();
    await registry.remove(id);
    expect(getSettings().configuredModels.find((m) => m.configuredModelId === id)).toBeUndefined();
  });
});
