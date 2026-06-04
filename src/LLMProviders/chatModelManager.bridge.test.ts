import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { getSettings, setSettings } from "@/settings/model";

import ChatModelManager from "./chatModelManager";

jest.mock("@langchain/anthropic", () => ({ ChatAnthropic: class {} }));
jest.mock("@langchain/groq", () => ({ ChatGroq: class {} }));

function bridgedModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "gpt-4o-mini",
    provider: ChatModelProviders.OPENAI,
    enabled: true,
    ...overrides,
  };
}

describe("ChatModelManager bridged models", () => {
  const originalOpenAiKey = getSettings().openAIApiKey;

  afterEach(() => {
    setSettings({ openAIApiKey: originalOpenAiKey });
  });

  it("does not fall back to a legacy top-level provider key", async () => {
    setSettings({ openAIApiKey: "legacy-key" });

    await expect(
      ChatModelManager.getInstance().createModelInstanceFromBridged(bridgedModel())
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("retains the active bridged model for temperature overrides", async () => {
    const manager = ChatModelManager.getInstance();
    const model = bridgedModel({ apiKey: "bridge-key" });

    await manager.setChatModelFromBridged(model);

    expect(manager.getActiveModel()).toBe(model);
    await expect(manager.getChatModelWithTemperature(0)).resolves.toBeDefined();
  });
});
