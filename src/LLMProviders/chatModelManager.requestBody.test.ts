import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_MAX_OUTPUT_TOKENS } from "@/constants";

import * as obsidianModule from "obsidian";

import ChatModelManager from "./chatModelManager";

/** The obsidian mock's seam for stubbing `requestUrl` per test. */
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

/**
 * What ends up in the HTTP body.
 *
 * The other suites here mock the LangChain clients and assert the config object
 * Copilot hands them. That cannot show whether a parameter survives the client's
 * own serialization. These tests run the real clients and capture the request
 * body Obsidian is asked to send, so a limit Copilot thinks it left out and the
 * SDK puts back fails here.
 * https://github.com/logancyang/obsidian-copilot-preview/issues/312
 */

const OPENAI_RESPONSE = JSON.stringify({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "test-model",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const ANTHROPIC_RESPONSE = JSON.stringify({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
});

/** Captures the body of the single request the model under test sends. */
function captureRequestBody(responseText: string): () => Record<string, unknown> {
  let captured: Record<string, unknown> = {};
  const parsedResponse = JSON.parse(responseText) as Record<string, unknown>;
  setRequestUrlImpl((request: { body?: string }) => {
    captured = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {};
    return Promise.resolve({
      status: 200,
      text: responseText,
      json: parsedResponse,
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": "application/json" },
    });
  });
  return () => captured;
}

/**
 * `enableCors` routes the client through `safeFetch`, where the body can be
 * read. `stream: false` matters too. The Anthropic SDK refuses a non-streaming
 * request whose `max_tokens` it estimates will take over ten minutes, and it
 * throws before sending anything, so raising `DEFAULT_MAX_OUTPUT_TOKENS` too
 * far fails these tests rather than reaching users.
 */
function wireModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI_FORMAT,
    enabled: true,
    enableCors: true,
    stream: false,
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    ...overrides,
  };
}

async function send(model: CustomModel): Promise<void> {
  const instance = await ChatModelManager.getInstance().createModelInstanceFromBridged(model);
  await instance.invoke("hi");
}

describe("chatModelManager", () => {
  describe("ChatModelManager", () => {
    describe("createModelInstanceFromBridged()", () => {
      it("sends an OpenAI-compatible request with no output limit at all (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel());

        expect(body()).not.toHaveProperty("max_tokens");
        expect(body()).not.toHaveProperty("max_completion_tokens");
      });

      it("sends an explicit per-model output limit when the model carries one", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel({ maxTokens: 8192 }));

        expect(body().max_tokens).toBe(8192);
      });

      it("sends Anthropic the ceiling the bridge resolved for the model (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        const body = captureRequestBody(ANTHROPIC_RESPONSE);

        await send(
          wireModel({
            name: "claude-sonnet-4-5",
            provider: ChatModelProviders.ANTHROPIC,
            baseUrl: "https://anthropic.invalid",
            maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          })
        );

        expect(body().max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
      });
    });
  });
});
