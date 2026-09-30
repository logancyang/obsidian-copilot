import { ChatModelProviders } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

import {
  findChatBackendEntry,
  isChatModelSelectionForEntry,
  resolveChatModelSelectionId,
} from "./chatModelSelection";

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
  describe("findChatBackendEntry()", () => {
    it("returns the entry whose configured-model id is selected", () => {
      const p = provider("p1");
      const entries = [entry("a", "gpt-4o", p), entry("b", "gpt-5", p)];

      expect(findChatBackendEntry(entries, "b")?.configuredModelId).toBe("b");
    });

    it("returns the first usable entry when nothing is selected", () => {
      const p = provider("p1");
      const entries: EnabledBackendEntry[] = [
        { configuredModelId: "broken", state: "broken" },
        entry("a", "gpt-4o", p),
      ];

      expect(findChatBackendEntry(entries, undefined)?.configuredModelId).toBe("a");
    });

    it("returns undefined when no entry is usable", () => {
      expect(
        findChatBackendEntry([{ configuredModelId: "broken", state: "broken" }], "broken")
      ).toBeUndefined();
    });
  });

  describe("isChatModelSelectionForEntry()", () => {
    it("matches the entry's configured-model id and its legacy name|provider key", () => {
      const target = entry("a", "gpt-4o", provider("p1"));

      expect(isChatModelSelectionForEntry(target, "a")).toBe(true);
      expect(isChatModelSelectionForEntry(target, `gpt-4o|${ChatModelProviders.OPENAI}`)).toBe(
        true
      );
    });

    it("rejects a selection that names a different model or provider", () => {
      const target = entry("a", "gpt-4o", provider("p1"));

      expect(isChatModelSelectionForEntry(target, "b")).toBe(false);
      expect(isChatModelSelectionForEntry(target, `gpt-5|${ChatModelProviders.OPENAI}`)).toBe(
        false
      );
      expect(isChatModelSelectionForEntry(target, `gpt-4o|${ChatModelProviders.ANTHROPIC}`)).toBe(
        false
      );
    });
  });

  describe("resolveChatModelSelectionId()", () => {
    it("returns the configured-model id that was selected", () => {
      const p = provider("p1");
      const entries = [entry("a", "gpt-4o", p), entry("b", "gpt-5", p)];

      expect(resolveChatModelSelectionId(entries, "b")).toBe("b");
    });

    it("maps a legacy name|provider key to its configured model", () => {
      const p = provider("p1");
      const target = entry("a", "gpt-4o", p);

      expect(resolveChatModelSelectionId([target], `gpt-4o|${ChatModelProviders.OPENAI}`)).toBe(
        "a"
      );
    });

    it("maps a legacy Copilot Plus key to the Plus configured model", () => {
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

    it("maps a legacy local-provider key to the migrated openai-compatible model", () => {
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

    it("maps a legacy xAI key when the endpoint is a custom OpenAI-format URL", () => {
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

    it("falls back to the first usable entry when the selection matches nothing", () => {
      const p = provider("p1");
      const entries: EnabledBackendEntry[] = [
        { configuredModelId: "broken", state: "broken" },
        entry("a", "gpt-4o", p),
      ];

      expect(resolveChatModelSelectionId(entries, "gone")).toBe("a");
    });
  });
});
