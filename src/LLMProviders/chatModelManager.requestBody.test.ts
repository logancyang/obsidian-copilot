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

/**
 * The sampling knobs Copilot no longer sends. Copilot never exposed a control
 * for any of them, and providers disagree on which values a model accepts, so
 * each provider's own default is the better answer than Copilot's guess.
 * https://github.com/logancyang/obsidian-copilot/issues/2959
 */
const RETIRED_SAMPLING_PARAMS = ["temperature", "top_p", "frequency_penalty"];

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

/**
 * Answers every request with a provider-style 400 so the error the SDK raises
 * can be inspected. Mirrors what Moonshot returns for a rejected parameter.
 */
function respondWithBadRequest(message: string): void {
  const body = JSON.stringify({ error: { message, type: "invalid_request_error" } });
  setRequestUrlImpl(() =>
    Promise.resolve({
      status: 400,
      text: body,
      json: JSON.parse(body) as Record<string, unknown>,
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": "application/json" },
    })
  );
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

      it("sends no sampling parameters, so the provider applies its own defaults (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel());

        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it("sends Anthropic no sampling parameters either (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        const body = captureRequestBody(ANTHROPIC_RESPONSE);

        await send(
          wireModel({
            name: "claude-sonnet-4-5",
            provider: ChatModelProviders.ANTHROPIC,
            baseUrl: "https://anthropic.invalid",
            maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          })
        );

        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it("surfaces a rejected request as the provider's own message rather than a connection failure (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        respondWithBadRequest("invalid temperature: only 1 is allowed for this model");

        const error = await send(wireModel()).catch((raised: unknown) => raised);

        expect(error).toMatchObject({ status: 400 });
        expect(String(error)).toContain("invalid temperature: only 1 is allowed for this model");
        expect(String(error)).not.toContain("Connection error");
      });

      it("stops retrying a request the provider has rejected (https://github.com/logancyang/obsidian-copilot/issues/2959)", async () => {
        let attempts = 0;
        const body = JSON.stringify({ error: { message: "nope", type: "invalid_request_error" } });
        setRequestUrlImpl(() => {
          attempts += 1;
          return Promise.resolve({
            status: 400,
            text: body,
            json: JSON.parse(body) as Record<string, unknown>,
            arrayBuffer: new ArrayBuffer(0),
            headers: { "content-type": "application/json" },
          });
        });

        await expect(send(wireModel())).rejects.toThrow();

        expect(attempts).toBe(1);
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
