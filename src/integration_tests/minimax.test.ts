/**
 * MiniMax provider integration tests.
 *
 * These tests verify that MiniMax API calls work end-to-end.
 * They require a MINIMAX_API_KEY environment variable to be set.
 *
 * Run with: npm run test:integration -- -t "MiniMax"
 */
import * as dotenv from "dotenv";

// Add global fetch polyfill for Node.js environments
import fetch, { Headers, Request, Response } from "node-fetch";
if (!globalThis.fetch) {
  globalThis.fetch = fetch as any;
  globalThis.Headers = Headers as any;
  globalThis.Request = Request as any;
  globalThis.Response = Response as any;
}

// Add TextDecoderStream polyfill for Node.js environments
import "web-streams-polyfill/dist/polyfill.js";

// Load environment variables from .env.test
dotenv.config({ path: ".env.test" });

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;
const describeIntegration = MINIMAX_API_KEY ? describe : describe.skip;

describeIntegration("MiniMax integration", () => {
  it("should complete a chat request with MiniMax-M2.7", async () => {
    const chat = new ChatOpenAI({
      modelName: "MiniMax-M2.7",
      apiKey: MINIMAX_API_KEY!,
      configuration: {
        baseURL: "https://api.minimax.io/v1",
      },
      maxTokens: 50,
      temperature: 0.7,
    });

    const response = await chat.invoke([new HumanMessage("Say hello in one sentence.")]);
    expect(response.content).toBeTruthy();
    expect(typeof response.content).toBe("string");
  }, 30000);

  it("should complete a chat request with MiniMax-M2.5", async () => {
    const chat = new ChatOpenAI({
      modelName: "MiniMax-M2.5",
      apiKey: MINIMAX_API_KEY!,
      configuration: {
        baseURL: "https://api.minimax.io/v1",
      },
      maxTokens: 50,
      temperature: 0.7,
    });

    const response = await chat.invoke([new HumanMessage("Say hello in one sentence.")]);
    expect(response.content).toBeTruthy();
    expect(typeof response.content).toBe("string");
  }, 30000);

  it("should support streaming with MiniMax", async () => {
    const chat = new ChatOpenAI({
      modelName: "MiniMax-M2.7",
      apiKey: MINIMAX_API_KEY!,
      configuration: {
        baseURL: "https://api.minimax.io/v1",
      },
      maxTokens: 50,
      temperature: 0.7,
      streaming: true,
    });

    const chunks: string[] = [];
    const stream = await chat.stream([new HumanMessage("Count from 1 to 3.")]);

    for await (const chunk of stream) {
      if (typeof chunk.content === "string" && chunk.content) {
        chunks.push(chunk.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullResponse = chunks.join("");
    expect(fullResponse).toBeTruthy();
  }, 30000);
});
