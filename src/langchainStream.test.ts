jest.mock("@/settings/model", () => ({
  getSettings: () => ({ debug: false }),
}));

import { AI_SENDER } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { getAIResponse } from "@/langchainStream";
import { ChatMessage } from "@/types/message";

describe("getAIResponse onboarding errors", () => {
  it("surfaces missing API key as an AI error message without throwing", async () => {
    const addMessage = jest.fn();
    const updateCurrentAiMessage = jest.fn();
    const updateShouldAbort = jest.fn();

    const chainManager = {
      runChain: jest.fn(async () => {
        throw new MissingApiKeyError("API key is not configured for the selected model.");
      }),
    } as unknown as any;

    const userMessage: ChatMessage = {
      id: "user-1",
      message: "hello",
      sender: "user",
      timestamp: null,
      isVisible: true,
    };

    await getAIResponse(
      userMessage,
      chainManager,
      addMessage,
      updateCurrentAiMessage,
      updateShouldAbort
    );

    expect(chainManager.runChain).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledTimes(1);

    const errorMessage = addMessage.mock.calls[0][0] as ChatMessage;
    expect(errorMessage.sender).toBe(AI_SENDER);
    expect(errorMessage.isErrorMessage).toBe(true);
    expect(errorMessage.message).toContain("API key");
  });
});
