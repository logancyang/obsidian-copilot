import { ABORT_REASON, AI_SENDER } from "@/constants";
import type ChainManager from "@/LLMProviders/chainManager";
import { BaseChainRunner } from "@/LLMProviders/chainRunner/BaseChainRunner";
import type { ChatMessage } from "@/types/message";

jest.mock("@/logger");

/** `handleResponse` is protected on an abstract class, so reach it through a subclass. */
class TestChainRunner extends BaseChainRunner {
  run(): Promise<string> {
    throw new Error("not used");
  }

  callHandleResponse(
    fullAIResponse: string,
    addMessage: (message: ChatMessage) => void,
    responseMetadata?: { wasTruncated?: boolean }
  ): Promise<string> {
    return (
      this as unknown as {
        handleResponse: (
          fullAIResponse: string,
          userMessage: ChatMessage,
          abortController: AbortController,
          addMessage: (message: ChatMessage) => void,
          updateCurrentAiMessage: (message: string) => void,
          sources?: unknown,
          llmFormattedOutput?: string,
          responseMetadata?: unknown
        ) => Promise<string>;
      }
    ).handleResponse(
      fullAIResponse,
      {
        message: "how long is the coastline of Britain?",
        sender: "user",
        isVisible: true,
      } as ChatMessage,
      new AbortController(),
      addMessage,
      jest.fn(),
      undefined,
      undefined,
      responseMetadata
    );
  }
}

function createRunner(): TestChainRunner {
  const chainManager = {
    memoryManager: {
      saveContext: jest.fn().mockResolvedValue(undefined),
      getMemory: () => ({ chatHistory: { messages: [] } }),
    },
  } as unknown as ChainManager;
  return new TestChainRunner(chainManager);
}

describe("BaseChainRunner", () => {
  describe("BaseChainRunner", () => {
    describe("handleResponse()", () => {
      it("explains an empty truncated response as the model's own limit (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        // Copilot sets no output limit any more, so the note cannot tell the
        // reader to raise one.
        const addMessage = jest.fn();
        const runner = createRunner();

        await runner.callHandleResponse("", addMessage, { wasTruncated: true });

        expect(addMessage).toHaveBeenCalledTimes(1);
        const added = addMessage.mock.calls[0][0] as ChatMessage;
        expect(added.message).toBe(
          "_[The model stopped at its maximum response length before generating any content.]_"
        );
        expect(added.sender).toBe(AI_SENDER);
      });

      it("keeps the model's own text when a truncated response has content", async () => {
        const addMessage = jest.fn();
        const runner = createRunner();

        await runner.callHandleResponse("The coastline is famously hard to", addMessage, {
          wasTruncated: true,
        });

        const added = addMessage.mock.calls[0][0] as ChatMessage;
        expect(added.message).toBe("The coastline is famously hard to");
      });

      it("adds no message when the run was aborted for a new chat", async () => {
        const addMessage = jest.fn();
        const runner = createRunner();
        const abortController = new AbortController();
        abortController.abort(ABORT_REASON.NEW_CHAT);

        await (
          runner as unknown as {
            handleResponse: (...args: unknown[]) => Promise<string>;
          }
        ).handleResponse(
          "",
          { message: "hi", sender: "user", isVisible: true },
          abortController,
          addMessage,
          jest.fn(),
          undefined,
          undefined,
          { wasTruncated: true }
        );

        expect(addMessage).not.toHaveBeenCalled();
      });
    });
  });
});
