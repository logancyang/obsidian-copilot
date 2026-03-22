import {
  BUILTIN_CHAT_MODELS,
  ChatModelProviders,
  ChatModels,
  DEFAULT_SETTINGS,
  ProviderInfo,
  ProviderSettingsKeyMap,
} from "@/constants";
import { providerAdapters, MiniMaxModelResponse } from "@/settings/providerModels";

describe("MiniMax provider registration", () => {
  it("should have MINIMAX in ChatModelProviders enum", () => {
    expect(ChatModelProviders.MINIMAX).toBe("minimax");
  });

  it("should have MiniMax-M2.7 in ChatModels enum", () => {
    expect(ChatModels.MINIMAX_M2_7).toBe("MiniMax-M2.7");
  });

  it("should have MiniMax-M2.5 in ChatModels enum", () => {
    expect(ChatModels.MINIMAX_M2_5).toBe("MiniMax-M2.5");
  });
});

describe("MiniMax built-in models", () => {
  const minimaxModels = BUILTIN_CHAT_MODELS.filter(
    (m) => m.provider === ChatModelProviders.MINIMAX
  );

  it("should include MiniMax models in BUILTIN_CHAT_MODELS", () => {
    expect(minimaxModels.length).toBe(2);
  });

  it("should have MiniMax-M2.7 model", () => {
    const m27 = minimaxModels.find((m) => m.name === ChatModels.MINIMAX_M2_7);
    expect(m27).toBeDefined();
    expect(m27!.provider).toBe(ChatModelProviders.MINIMAX);
    expect(m27!.isBuiltIn).toBe(true);
  });

  it("should have MiniMax-M2.5 model", () => {
    const m25 = minimaxModels.find((m) => m.name === ChatModels.MINIMAX_M2_5);
    expect(m25).toBeDefined();
    expect(m25!.provider).toBe(ChatModelProviders.MINIMAX);
    expect(m25!.isBuiltIn).toBe(true);
  });

  it("should have MiniMax models disabled by default", () => {
    minimaxModels.forEach((m) => {
      expect(m.enabled).toBe(false);
    });
  });
});

describe("MiniMax ProviderInfo", () => {
  const info = ProviderInfo[ChatModelProviders.MINIMAX];

  it("should have MiniMax provider info", () => {
    expect(info).toBeDefined();
  });

  it("should have correct label", () => {
    expect(info.label).toBe("MiniMax");
  });

  it("should have correct API host", () => {
    expect(info.host).toBe("https://api.minimax.io/v1");
  });

  it("should have correct curlBaseURL", () => {
    expect(info.curlBaseURL).toBe("https://api.minimax.io/v1");
  });

  it("should have key management URL", () => {
    expect(info.keyManagementURL).toBeTruthy();
    expect(info.keyManagementURL).toContain("minimaxi.com");
  });

  it("should have list model URL", () => {
    expect(info.listModelURL).toBe("https://api.minimax.io/v1/models");
  });

  it("should have test model set to MiniMax-M2.7", () => {
    expect(info.testModel).toBe(ChatModels.MINIMAX_M2_7);
  });
});

describe("MiniMax settings key mapping", () => {
  it("should map minimax provider to minimaxApiKey setting", () => {
    expect(ProviderSettingsKeyMap["minimax" as keyof typeof ProviderSettingsKeyMap]).toBe(
      "minimaxApiKey"
    );
  });
});

describe("MiniMax default settings", () => {
  it("should have minimaxApiKey in DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS).toHaveProperty("minimaxApiKey");
    expect(DEFAULT_SETTINGS.minimaxApiKey).toBe("");
  });
});

describe("MiniMax provider model adapter", () => {
  const adapter = providerAdapters[ChatModelProviders.MINIMAX];

  it("should have a model adapter for MiniMax", () => {
    expect(adapter).toBeDefined();
  });

  it("should parse MiniMax model list response", () => {
    const mockResponse: MiniMaxModelResponse = {
      object: "list",
      data: [
        { id: "MiniMax-M2.7", object: "model", created: 1710000000, owned_by: "minimax" },
        { id: "MiniMax-M2.5", object: "model", created: 1700000000, owned_by: "minimax" },
      ],
    };

    const models = adapter!(mockResponse);
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe("MiniMax-M2.7");
    expect(models[0].name).toBe("MiniMax-M2.7");
    expect(models[0].provider).toBe(ChatModelProviders.MINIMAX);
    expect(models[1].id).toBe("MiniMax-M2.5");
  });

  it("should handle empty model list", () => {
    const mockResponse: MiniMaxModelResponse = {
      object: "list",
      data: [],
    };

    const models = adapter!(mockResponse);
    expect(models).toHaveLength(0);
  });

  it("should handle missing data field gracefully", () => {
    const mockResponse = { object: "list" } as any;
    const models = adapter!(mockResponse);
    expect(models).toEqual([]);
  });
});
