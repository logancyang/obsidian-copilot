import { v4 as uuidv4 } from "uuid";

import { getSettings, setSettings } from "@/settings/model";
import { frozenOr, sliceMemoByKey } from "@/utils/sliceCache";

import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";

const EMPTY_LIST: readonly ConfiguredModel[] = Object.freeze([]);

export class ConfiguredModelRegistry {
  readonly #byProvider = sliceMemoByKey((source: readonly ConfiguredModel[], providerId: string) =>
    frozenOr(
      source.filter((m) => m.providerId === providerId),
      EMPTY_LIST
    )
  );

  constructor() {}

  list(): readonly ConfiguredModel[] {
    const source = getSettings().configuredModels;
    return source.length === 0 ? EMPTY_LIST : source;
  }

  listByProvider(providerId: string): readonly ConfiguredModel[] {
    return this.#byProvider(getSettings().configuredModels, providerId);
  }

  get(configuredModelId: string): ConfiguredModel | undefined {
    return getSettings().configuredModels.find((m) => m.configuredModelId === configuredModelId);
  }

  getByWireId(providerId: string, wireModelId: string): ConfiguredModel | undefined {
    return getSettings().configuredModels.find(
      (m) => m.providerId === providerId && m.info.id === wireModelId
    );
  }

  async add(input: Omit<ConfiguredModel, "configuredModelId" | "configuredAt">): Promise<string> {
    const existing = getSettings().configuredModels;
    if (existing.some((m) => m.providerId === input.providerId && m.info.id === input.info.id)) {
      throw new Error(
        `[modelManagement] ConfiguredModelRegistry.add: ` +
          `model "${input.info.id}" already configured for providerId ${input.providerId}`
      );
    }
    const configuredModelId = uuidv4();
    const row: ConfiguredModel = {
      ...input,
      configuredModelId,
      configuredAt: Date.now(),
    };
    setSettings((cur) => ({
      configuredModels: [...cur.configuredModels, row],
    }));
    return configuredModelId;
  }

  async update(configuredModelId: string, patch: { info?: Partial<ModelInfo> }): Promise<void> {
    const existing = getSettings().configuredModels.find(
      (m) => m.configuredModelId === configuredModelId
    );
    if (!existing) {
      throw new Error(
        `[modelManagement] ConfiguredModelRegistry.update: unknown configuredModelId ${configuredModelId}`
      );
    }
    if (!patch.info) return;
    const next: ConfiguredModel = {
      ...existing,
      info: { ...existing.info, ...patch.info },
    };
    setSettings((cur) => ({
      configuredModels: cur.configuredModels.map((m) =>
        m.configuredModelId === configuredModelId ? next : m
      ),
    }));
  }

  async remove(configuredModelId: string): Promise<void> {
    setSettings((cur) => ({
      configuredModels: cur.configuredModels.filter(
        (m) => m.configuredModelId !== configuredModelId
      ),
    }));
  }

  async bulkSet(providerId: string, infos: readonly ModelInfo[]): Promise<string[]> {
    const current = getSettings().configuredModels;
    const existingForProvider = new Map<string, ConfiguredModel>();
    for (const m of current) {
      if (m.providerId === providerId) existingForProvider.set(m.info.id, m);
    }

    const resultIds: string[] = [];
    const reusedOrNew: ConfiguredModel[] = [];
    const seenInfoIds = new Set<string>();
    const now = Date.now();
    for (const info of infos) {
      if (seenInfoIds.has(info.id)) continue;
      seenInfoIds.add(info.id);
      const reused = existingForProvider.get(info.id);
      if (reused) {
        reusedOrNew.push(isSameInfo(reused.info, info) ? reused : { ...reused, info });
        resultIds.push(reused.configuredModelId);
      } else {
        const configuredModelId = uuidv4();
        const row: ConfiguredModel = {
          configuredModelId,
          providerId,
          info,
          configuredAt: now,
        };
        reusedOrNew.push(row);
        resultIds.push(configuredModelId);
      }
    }

    setSettings((cur) => ({
      configuredModels: [
        ...cur.configuredModels.filter((m) => m.providerId !== providerId),
        ...reusedOrNew,
      ],
    }));
    return resultIds;
  }

  async removeByProvider(providerId: string): Promise<void> {
    setSettings((cur) => ({
      configuredModels: cur.configuredModels.filter((m) => m.providerId !== providerId),
    }));
  }
}

function isSameInfo(a: ModelInfo, b: ModelInfo): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}
