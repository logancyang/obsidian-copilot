jest.mock("@/settings/model", () => ({
  getSettings: () => ({ debug: false }),
}));

import { transformWireToCatalog } from "./catalogTransform";
import type { WireCatalog } from "./modelsDevWire";

function makeWire(providers: WireCatalog): WireCatalog {
  return providers;
}

describe("transformWireToCatalog", () => {
  describe("npm → providerType mapping", () => {
    it.each([
      ["@ai-sdk/anthropic", "anthropic"],
      ["@ai-sdk/google", "google"],
      ["@ai-sdk/azure", "azure"],
      ["@ai-sdk/amazon-bedrock", "bedrock"],
      ["@ai-sdk/openai-compatible", "openai-compatible"],
      ["@ai-sdk/openai", "openai-compatible"],
      [undefined, "openai-compatible"],
      ["something-unknown", "openai-compatible"],
    ])("maps npm=%s → providerType=%s", (npm, expected) => {
      const wire = makeWire({
        p: { id: "p", name: "P", api: "https://p.example", npm },
      });
      const result = transformWireToCatalog(wire);
      expect(result).toHaveLength(1);
      expect(result[0].providerType).toBe(expected);
    });
  });

  it("falls back to wire.id for displayName when name is missing, omits defaultBaseUrl when api absent", () => {
    const wire = makeWire({ ghost: { id: "ghost" } });
    const [provider] = transformWireToCatalog(wire);
    expect(provider.displayName).toBe("ghost");
    expect(provider.defaultBaseUrl).toBeUndefined();
    expect(provider.models).toEqual({});
  });

  it("drops provider entries with non-string id", () => {
    const wire = {
      good: { id: "good", name: "Good" },
      bad: { id: 42 as unknown as string, name: "Bad" },
    } as unknown as WireCatalog;
    const result = transformWireToCatalog(wire);
    expect(result.map((p) => p.id)).toEqual(["good"]);
  });

  it("drops individual models with non-string id but keeps siblings", () => {
    const wire = {
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        npm: "@ai-sdk/anthropic",
        models: {
          sonnet: { id: "sonnet", name: "Sonnet" },
          broken: { id: 7 as unknown as string, name: "Broken" },
        },
      },
    } as unknown as WireCatalog;
    const [provider] = transformWireToCatalog(wire);
    expect(Object.keys(provider.models)).toEqual(["sonnet"]);
  });

  it("renames snake_case fields to camelCase on models", () => {
    const wire = makeWire({
      anthropic: {
        id: "anthropic",
        name: "Anthropic",
        npm: "@ai-sdk/anthropic",
        models: {
          "claude-sonnet-4-5": {
            id: "claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            tool_call: true,
            reasoning: true,
            release_date: "2025-09-29",
            modalities: { input: ["text", "image"], output: ["text"] },
            limit: { context: 200000, output: 64000 },
            cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 },
          },
        },
      },
    });
    const [provider] = transformWireToCatalog(wire);
    const model = provider.models["claude-sonnet-4-5"];
    expect(model.toolCall).toBe(true);
    expect(model.reasoning).toBe(true);
    expect(model.releaseDate).toBe("2025-09-29");
    expect(model.modalities).toEqual({ input: ["text", "image"], output: ["text"] });
    expect(model.limits).toEqual({ context: 200000, output: 64000 });
    expect(model.cost).toEqual({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  });

  it("omits optional fields when the wire lacks them", () => {
    const wire = makeWire({
      ollamaish: {
        id: "ollamaish",
        name: "Ollamaish",
        models: { tiny: { id: "tiny", name: "Tiny" } },
      },
    });
    const [provider] = transformWireToCatalog(wire);
    const model = provider.models["tiny"];
    expect(model.modalities).toBeUndefined();
    expect(model.limits).toBeUndefined();
    expect(model.cost).toBeUndefined();
    expect(model.reasoning).toBeUndefined();
    expect(model.toolCall).toBeUndefined();
    expect(model.releaseDate).toBeUndefined();
    expect(model.isEmbedding).toBeUndefined();
  });

  it("flags embedding models from the `family` field", () => {
    const wire = makeWire({
      openai: {
        id: "openai",
        name: "OpenAI",
        npm: "@ai-sdk/openai",
        models: {
          "text-embedding-3-small": {
            id: "text-embedding-3-small",
            name: "text-embedding-3-small",
            family: "text-embedding",
          },
          "gpt-4o": { id: "gpt-4o", name: "GPT-4o", family: "gpt", tool_call: true },
          "no-family": { id: "no-family", name: "No Family" },
        },
      },
    });
    const [provider] = transformWireToCatalog(wire);
    expect(provider.models["text-embedding-3-small"].isEmbedding).toBe(true);
    expect(provider.models["gpt-4o"].isEmbedding).toBeUndefined();
    expect(provider.models["no-family"].isEmbedding).toBeUndefined();
  });

  it("flags embedding models from the id when `family` is the base family or absent", () => {
    const wire = makeWire({
      google: {
        id: "google",
        name: "Google",
        npm: "@ai-sdk/google",
        models: {
          // family is the base model family, not "embedding"
          "gemini-embedding-001": {
            id: "gemini-embedding-001",
            name: "Gemini Embedding",
            family: "gemini",
          },
          // no family at all
          "nv-embed-v2": { id: "nv-embed-v2", name: "NV Embed v2" },
          "gemini-2.5-pro": { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", family: "gemini" },
        },
      },
    });
    const [provider] = transformWireToCatalog(wire);
    expect(provider.models["gemini-embedding-001"].isEmbedding).toBe(true);
    expect(provider.models["nv-embed-v2"].isEmbedding).toBe(true);
    expect(provider.models["gemini-2.5-pro"].isEmbedding).toBeUndefined();
  });

  it("emits partial cost when only one side is present", () => {
    const wire = makeWire({
      partial: {
        id: "partial",
        name: "Partial",
        models: {
          inputOnly: { id: "inputOnly", name: "Input Only", cost: { input: 1 } },
          outputOnly: { id: "outputOnly", name: "Output Only", cost: { output: 15 } },
          empty: { id: "empty", name: "Empty", cost: {} },
        },
      },
    });
    const [provider] = transformWireToCatalog(wire);
    expect(provider.models["inputOnly"].cost).toEqual({ input: 1 });
    expect(provider.models["outputOnly"].cost).toEqual({ output: 15 });
    expect(provider.models["empty"].cost).toBeUndefined();
  });

  it("emits partial limits without zero-defaulting unknown fields", () => {
    const wire = makeWire({
      partial: {
        id: "partial",
        name: "Partial",
        models: {
          contextOnly: { id: "contextOnly", name: "Context Only", limit: { context: 200000 } },
          inputOnly: { id: "inputOnly", name: "Input Only", limit: { input: 8192 } },
          empty: { id: "empty", name: "Empty", limit: {} },
        },
      },
    });
    const [provider] = transformWireToCatalog(wire);
    expect(provider.models["contextOnly"].limits).toEqual({ context: 200000 });
    expect(provider.models["inputOnly"].limits).toEqual({ input: 8192 });
    expect(provider.models["empty"].limits).toBeUndefined();
  });

  it("emits partial modalities when only one side is present", () => {
    const wire = makeWire({
      partial: {
        id: "partial",
        name: "Partial",
        models: {
          inputOnly: {
            id: "inputOnly",
            name: "Input Only",
            modalities: { input: ["text", "image"] },
          },
          outputOnly: {
            id: "outputOnly",
            name: "Output Only",
            modalities: { output: ["text"] },
          },
        },
      },
    });
    const [provider] = transformWireToCatalog(wire);
    expect(provider.models["inputOnly"].modalities).toEqual({ input: ["text", "image"] });
    expect(provider.models["outputOnly"].modalities).toEqual({ output: ["text"] });
  });

  it("uses wire.id as the canonical provider id (not the object key)", () => {
    const wire = {
      "renamed-key": {
        id: "actual-id",
        name: "Renamed",
        npm: "@ai-sdk/anthropic",
      },
    } as unknown as WireCatalog;
    const [provider] = transformWireToCatalog(wire);
    expect(provider.id).toBe("actual-id");
  });

  it("skips non-object top-level entries (e.g. future `_meta` siblings) without rejecting siblings", () => {
    const wire = {
      _meta: { generated_at: "2026-05-22" },
      _version: 2,
      openai: { id: "openai", name: "OpenAI", npm: "@ai-sdk/openai" },
    } as unknown as WireCatalog;
    const result = transformWireToCatalog(wire);
    expect(result.map((p) => p.id)).toEqual(["openai"]);
  });

  it("sorts providers alphabetically by displayName", () => {
    const wire = makeWire({
      zeta: { id: "zeta", name: "Zeta" },
      alpha: { id: "alpha", name: "Alpha" },
      mid: { id: "mid", name: "Mid" },
    });
    const result = transformWireToCatalog(wire);
    expect(result.map((p) => p.displayName)).toEqual(["Alpha", "Mid", "Zeta"]);
  });

  it("handles a provider with no models block", () => {
    const wire = makeWire({ empty: { id: "empty", name: "Empty" } });
    const [provider] = transformWireToCatalog(wire);
    expect(provider.models).toEqual({});
  });
});
