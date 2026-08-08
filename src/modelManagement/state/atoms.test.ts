/**
 * Self-Host Mode gating on the reactive picker atom (`backendPickerAtomFamily`,
 * chokepoint #1). Mirrors the `BackendConfigRegistry.resolveEnabled` gating
 * (chokepoint #2) but through the Jotai read layer that drives the chat picker.
 */

import { getSettings, resetSettings, setSettings, settingsStore } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

import { backendPickerAtomFamily, byokProvidersAtom, visibleByokProvidersAtom } from "./atoms";

function provider(id: string, origin: Provider["origin"], baseUrl?: string): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName: id,
    baseUrl,
    origin,
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: configuredModelId, displayName: configuredModelId },
    configuredAt: 0,
  };
}

const CLOUD = provider("cloud", { kind: "byok" }, "https://api.anthropic.com");
const LOCAL = provider("local", { kind: "byok" }, "http://localhost:11434/v1");

beforeEach(() => {
  resetSettings();
  setSettings({
    providers: { cloud: CLOUD, local: LOCAL },
    configuredModels: [model("cloud-m", "cloud"), model("local-m", "local")],
    backends: { chat: { enabledModels: ["cloud-m", "local-m", "missing"] } },
  });
});

function pickerIds(): string[] {
  return settingsStore.get(backendPickerAtomFamily("chat")).map((e) => e.configuredModelId);
}

function warningById(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const e of settingsStore.get(backendPickerAtomFamily("chat"))) {
    out[e.configuredModelId] = e.state === "ok" ? Boolean(e.needsSelfHostWarning) : false;
  }
  return out;
}

describe("backendPickerAtomFamily Self-Host Mode marking", () => {
  it("keeps every entry unflagged when the mode is off", () => {
    expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
    expect(warningById()).toEqual({ "cloud-m": false, "local-m": false, missing: false });
  });

  it("keeps every entry in order, flags cloud BYOK only, when on", () => {
    setSettings({ enableSelfHostMode: true });
    // Order preserved (this atom feeds runtime resolution) — nothing dropped.
    expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
    // Cloud flagged; self-hosted and broken refs are not.
    expect(warningById()).toEqual({ "cloud-m": true, "local-m": false, missing: false });
  });

  it("clears the flags when the mode is turned back off (no writeback)", () => {
    setSettings({ enableSelfHostMode: true });
    expect(warningById()["cloud-m"]).toBe(true);
    // The projection never rewrites the persisted enabledModels slice.
    expect(getSettings().backends.chat?.enabledModels).toEqual(["cloud-m", "local-m", "missing"]);

    setSettings({ enableSelfHostMode: false });
    expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
    expect(warningById()["cloud-m"]).toBe(false);
  });

  it("returns a stable frozen empty when no models are enabled", () => {
    setSettings({
      backends: { chat: { enabledModels: [] } },
      enableSelfHostMode: true,
    });
    const a = settingsStore.get(backendPickerAtomFamily("chat"));
    const b = settingsStore.get(backendPickerAtomFamily("chat"));
    expect(a).toHaveLength(0);
    expect(a).toBe(b);
  });
});

describe("visibleByokProvidersAtom Self-Host Mode ordering", () => {
  const visibleIds = (): string[] =>
    settingsStore.get(visibleByokProvidersAtom).map((p) => p.providerId);

  it("lists every BYOK provider when the mode is off", () => {
    expect(visibleIds().sort()).toEqual(["cloud", "local"]);
  });

  it("keeps cloud BYOK listed but sorts it below self-hosted when on", () => {
    setSettings({ enableSelfHostMode: true });
    // Self-hosted first, cloud (warned) last — nothing hidden.
    expect(visibleIds()).toEqual(["local", "cloud"]);
  });

  it("leaves the raw byokProvidersAtom untouched", () => {
    setSettings({ enableSelfHostMode: true });
    expect(
      settingsStore
        .get(byokProvidersAtom)
        .map((p) => p.providerId)
        .sort()
    ).toEqual(["cloud", "local"]);
  });

  it("restores the original order when the mode is turned back off", () => {
    setSettings({ enableSelfHostMode: true });
    expect(visibleIds()).toEqual(["local", "cloud"]);
    setSettings({ enableSelfHostMode: false });
    // byokProvidersAtom order is `Object.values(providers)` insertion order.
    expect(visibleIds()).toEqual(["cloud", "local"]);
  });

  it("returns a stable frozen empty when no BYOK providers exist (mode on)", () => {
    setSettings({ providers: {}, configuredModels: [], enableSelfHostMode: true });
    const a = settingsStore.get(visibleByokProvidersAtom);
    const b = settingsStore.get(visibleByokProvidersAtom);
    expect(a).toHaveLength(0);
    expect(a).toBe(b);
  });
});
