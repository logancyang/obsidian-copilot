import { ChatModelProviders } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import { findChatBackendEntry, resolveChatModelSelectionId } from "./chatModelSelection";

function provider(id: string, overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName: id,
    origin: { kind: "byok", catalogProviderId: "openai" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

function entry(
  configuredModelId: string,
  wireId: string,
  prov: Provider
): Extract<EnabledBackendEntry, { state: "ok" }> {
  const configuredModel: ConfiguredModel = {
    configuredModelId,
    providerId: prov.providerId,
    info: { id: wireId, displayName: wireId },
    configuredAt: 0,
  };
  return { configuredModelId, state: "ok", configuredModel, provider: prov };
}

describe("chatModelSelection", () => {
  it("resolves configured-model ids", () => {
    const p = provider("p1");
    const entries = [entry("a", "gpt-4o", p), entry("b", "gpt-5", p)];

    expect(findChatBackendEntry(entries, "b")?.configuredModelId).toBe("b");
    expect(resolveChatModelSelectionId(entries, "b")).toBe("b");
  });

  it("resolves legacy name|provider keys", () => {
    const p = provider("p1");
    const target = entry("a", "gpt-4o", p);

    expect(resolveChatModelSelectionId([target], `gpt-4o|${ChatModelProviders.OPENAI}`)).toBe("a");
  });

  it("resolves legacy Copilot Plus keys to the Plus configured model", () => {
    const plus = provider("plus", {
      origin: { kind: "copilot-plus" },
      requiresApiKey: false,
    });
    const byok = entry("byok", "gpt-4o", provider("p1"));
    const plusEntry = entry("plus-model", "copilot-plus-flash", plus);

    expect(
      resolveChatModelSelectionId(
        [byok, plusEntry],
        `copilot-plus-flash|${ChatModelProviders.COPILOT_PLUS}`
      )
    ).toBe("plus-model");
  });

  it("resolves legacy local-provider aliases after migration to openai-compatible", () => {
    const ollama = provider("ollama", {
      displayName: "Ollama",
      baseUrl: "http://localhost:11434/v1",
      origin: { kind: "byok" },
      requiresApiKey: false,
    });

    expect(
      resolveChatModelSelectionId(
        [entry("ollama-model", "qwen3", ollama)],
        `qwen3|${ChatModelProviders.OLLAMA}`
      )
    ).toBe("ollama-model");
  });

  it("resolves a legacy xAI key when a custom endpoint uses the OpenAI-format constructor", () => {
    const xai = provider("xai", {
      baseUrl: "https://proxy.example.com/v1",
      origin: { kind: "byok", catalogProviderId: "xai" },
    });

    expect(
      resolveChatModelSelectionId(
        [entry("xai-model", "grok-4", xai)],
        `grok-4|${ChatModelProviders.XAI}`
      )
    ).toBe("xai-model");
  });

  it("falls back to the first valid entry for stale selections", () => {
    const p = provider("p1");
    const entries: EnabledBackendEntry[] = [
      { configuredModelId: "broken", state: "broken" },
      entry("a", "gpt-4o", p),
    ];

    expect(resolveChatModelSelectionId(entries, "gone")).toBe("a");
  });
});
