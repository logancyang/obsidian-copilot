import { COPILOT_PLUS_PROVIDER_ID, FALLBACK_CONTEXT_WINDOW } from "@/pi/catalog";
import { createPiModels, listPiModels, parsePiModelWireId, piModelWireId } from "@/pi/providers";
import type { PiFetch, PiProviderDeps } from "@/pi/types";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
}));

const CATALOG_PAYLOAD = {
  object: "list",
  data: [
    {
      id: "gpt-5",
      label: "GPT-5",
      description: "Frontier model",
      context_length: "256K",
      supports_images: true,
      supports_reasoning: true,
    },
  ],
};

const catalogFetch: PiFetch = () =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CATALOG_PAYLOAD) });

function deps(overrides: Partial<PiProviderDeps> = {}): PiProviderDeps {
  return {
    plusLicenseKey: "plus-key",
    byokProviders: [],
    fetch: catalogFetch,
    ...overrides,
  };
}

const BYOK_ROW = {
  id: "my-openrouter",
  displayName: "My OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "byok-key",
  requiresApiKey: true,
  modelIds: ["z-ai/glm-5"],
};

/** A local runner: reachable with no credential at all. */
const KEYLESS_ROW = {
  id: "local-ollama",
  displayName: "Ollama",
  baseUrl: "http://localhost:11434/v1",
  apiKey: "",
  requiresApiKey: false,
  modelIds: ["llama3.2"],
};

describe("providers", () => {
  describe("createPiModels()", () => {
    it("registers the Copilot Plus provider pointed at the Brevilabs endpoint", () => {
      const provider = createPiModels(deps()).getProvider(COPILOT_PLUS_PROVIDER_ID);

      expect(provider?.name).toBe("Copilot Plus");
      expect(provider?.baseUrl).toBe("https://models.brevilabs.com/v1");
    });

    it("resolves the injected license key as the Copilot Plus api key", async () => {
      const models = createPiModels(deps());

      await expect(models.getAuth(COPILOT_PLUS_PROVIDER_ID)).resolves.toMatchObject({
        auth: { apiKey: "plus-key" },
      });
    });

    it("reports the Copilot Plus provider as unconfigured when no license key is set", async () => {
      const models = createPiModels(deps({ plusLicenseKey: "" }));

      await expect(models.getAuth(COPILOT_PLUS_PROVIDER_ID)).resolves.toBeUndefined();
    });

    it("starts with no Copilot Plus models and picks them up from the catalog on refresh", async () => {
      const models = createPiModels(deps());
      expect(models.getModels(COPILOT_PLUS_PROVIDER_ID)).toEqual([]);

      await models.refresh();

      expect(models.getModels(COPILOT_PLUS_PROVIDER_ID).map((model) => model.id)).toEqual([
        "gpt-5",
      ]);
    });

    it("registers one provider per BYOK row with its own key and static model list", async () => {
      const models = createPiModels(deps({ byokProviders: [BYOK_ROW] }));

      expect(models.getProvider(BYOK_ROW.id)?.name).toBe("My OpenRouter");
      await expect(models.getAuth(BYOK_ROW.id)).resolves.toMatchObject({
        auth: { apiKey: "byok-key" },
      });
      expect(models.getModels(BYOK_ROW.id)).toEqual([
        {
          id: "z-ai/glm-5",
          name: "z-ai/glm-5",
          api: "openai-completions",
          provider: BYOK_ROW.id,
          baseUrl: BYOK_ROW.baseUrl,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: FALLBACK_CONTEXT_WINDOW,
          maxTokens: 8192,
        },
      ]);
    });

    it("treats a keyless local runner as configured rather than unauthenticated", async () => {
      const models = createPiModels(deps({ byokProviders: [KEYLESS_ROW] }));

      await expect(models.getAuth(KEYLESS_ROW.id)).resolves.toEqual({
        auth: {},
        source: "no key required",
      });
      expect(models.getModels(KEYLESS_ROW.id).map((model) => model.id)).toEqual(["llama3.2"]);
    });

    it("reports an endpoint that needs a key but has none as unconfigured", async () => {
      const unkeyed = { ...BYOK_ROW, apiKey: "" };
      const models = createPiModels(deps({ byokProviders: [unkeyed] }));

      await expect(models.getAuth(unkeyed.id)).resolves.toBeUndefined();
    });
  });

  describe("piModelWireId()", () => {
    it("qualifies a model with the provider that serves it", () => {
      expect(piModelWireId("copilot-plus", "kimi-k2.6")).toBe("copilot-plus/kimi-k2.6");
    });
  });

  describe("parsePiModelWireId()", () => {
    it("splits on the first separator only, so slashes inside a model id survive", () => {
      expect(parsePiModelWireId("my-endpoint/deepseek-ai/DeepSeek-V3")).toEqual({
        providerId: "my-endpoint",
        modelId: "deepseek-ai/DeepSeek-V3",
      });
    });

    it("round-trips every id it produces", () => {
      const wireId = piModelWireId("p1", "z-ai/glm-5");

      expect(parsePiModelWireId(wireId)).toEqual({ providerId: "p1", modelId: "z-ai/glm-5" });
    });

    it("reports no provider for an unqualified id rather than inventing one", () => {
      expect(parsePiModelWireId("bare-model")).toEqual({ providerId: "", modelId: "bare-model" });
      expect(parsePiModelWireId("/leading")).toEqual({ providerId: "", modelId: "/leading" });
    });
  });

  describe("listPiModels()", () => {
    it("flattens every provider's models and carries the catalog description through", async () => {
      const models = createPiModels(deps({ byokProviders: [BYOK_ROW] }));
      await models.refresh();

      expect(listPiModels(models)).toEqual([
        {
          id: "gpt-5",
          wireId: `${COPILOT_PLUS_PROVIDER_ID}/gpt-5`,
          providerId: COPILOT_PLUS_PROVIDER_ID,
          label: "GPT-5",
          description: "Frontier model",
          contextWindow: 262_144,
          supportsImages: true,
          supportsReasoning: true,
        },
        {
          id: "z-ai/glm-5",
          wireId: `${BYOK_ROW.id}/z-ai/glm-5`,
          providerId: BYOK_ROW.id,
          label: "z-ai/glm-5",
          description: undefined,
          contextWindow: FALLBACK_CONTEXT_WINDOW,
          supportsImages: false,
          supportsReasoning: false,
        },
      ]);
    });

    it("keeps colliding model ids apart by provider, so each stays selectable", async () => {
      const collidingByok = { ...BYOK_ROW, id: "other-endpoint", modelIds: ["gpt-5"] };
      const models = createPiModels(deps({ byokProviders: [collidingByok] }));
      await models.refresh();

      const entries = listPiModels(models);

      expect(entries.map((entry) => entry.wireId)).toEqual([
        "copilot-plus/gpt-5",
        "other-endpoint/gpt-5",
      ]);
    });

    it("returns the same empty collection when no provider knows any model", () => {
      const models = createPiModels(deps());

      expect(listPiModels(models)).toBe(listPiModels(models));
    });
  });
});
