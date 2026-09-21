import type { Provider, ProviderOrigin, ProviderType } from "@/modelManagement";
import {
  isOpencodeZenWireId,
  mapProviderToOpencodeId,
  opencodeWireBaseId,
} from "@/utils/opencodeModelId";

/** Build a minimal `Provider` row for a given origin + type. */
function makeProvider(
  providerId: string,
  origin: ProviderOrigin,
  providerType: ProviderType = "anthropic"
): Provider {
  return { providerId, providerType, displayName: providerId, origin, addedAt: 0 };
}

describe("opencodeModelId", () => {
  describe("isOpencodeZenWireId()", () => {
    it.each([
      ["opencode/big-pickle", true],
      ["opencode/deepseek-v4-flash-free", true],
      ["lmstudio/gpt-oss-20b", false],
      ["openrouter/anthropic/claude", false],
      ["opencode-zen/x", false],
    ])("classifies %s as Zen: %s", (id, expected) => {
      expect(isOpencodeZenWireId(id)).toBe(expected);
    });
  });

  describe("mapProviderToOpencodeId()", () => {
    it("maps a BYOK provider with a catalog id to that id, non-native", () => {
      const provider = makeProvider("p1", { kind: "byok", catalogProviderId: "anthropic" });
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "anthropic", native: false });
    });

    it("maps BYOK openrouter to openrouter, non-native", () => {
      const provider = makeProvider("p1", { kind: "byok", catalogProviderId: "openrouter" });
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "openrouter", native: false });
    });

    it("returns null for a non-OpenAI-compatible BYOK provider without a catalog id", () => {
      const provider = makeProvider("p1", { kind: "byok" });
      expect(mapProviderToOpencodeId(provider)).toBeNull();
    });

    it("maps an OpenAI-compatible BYOK provider without a catalog id to its providerId", () => {
      const provider = makeProvider("p1", { kind: "byok" }, "openai-compatible");
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "p1", native: false });
    });

    it("returns null for a google BYOK provider without a catalog id", () => {
      expect(mapProviderToOpencodeId(makeProvider("p1", { kind: "byok" }, "google"))).toBeNull();
    });

    it("maps copilot-plus origin to the reserved copilot-plus id, non-native", () => {
      const provider = makeProvider("p1", { kind: "copilot-plus" });
      expect(mapProviderToOpencodeId(provider)).toEqual({ id: "copilot-plus", native: false });
    });

    it("maps an agent-origin provider to its providerId, native", () => {
      const provider = makeProvider("opencode-provider", { kind: "agent", agentType: "opencode" });
      expect(mapProviderToOpencodeId(provider)).toEqual({
        id: "opencode-provider",
        native: true,
      });
    });
  });

  describe("opencodeWireBaseId()", () => {
    it("prefixes a routed provider's model with the opencode provider id", () => {
      const provider = makeProvider("plus-1", { kind: "copilot-plus" });
      expect(opencodeWireBaseId(provider, "copilot-plus-flash")).toBe(
        "copilot-plus/copilot-plus-flash"
      );
    });

    it("keeps an agent-hosted provider's model id verbatim, since opencode already owns it", () => {
      const provider = makeProvider("opencode", { kind: "agent", agentType: "opencode" });
      expect(opencodeWireBaseId(provider, "opencode/big-pickle")).toBe("opencode/big-pickle");
    });

    it("returns null for a provider opencode cannot route", () => {
      const provider = makeProvider("p1", { kind: "byok" }, "google");
      expect(opencodeWireBaseId(provider, "gemini-3-pro")).toBeNull();
    });
  });
});
