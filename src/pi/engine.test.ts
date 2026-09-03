import { createPiEngine } from "@/pi/engine";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { AgentHarness } from "@earendil-works/pi-agent-core";
import type { Api, Model, Models } from "@earendil-works/pi-ai";

interface MockHarness {
  options: { session: unknown; models: Models; model: Model<Api>; systemPrompt?: string };
  model: Model<Api>;
  prompt: jest.Mock;
  abort: jest.Mock;
  waitForIdle: jest.Mock;
  compact: jest.Mock;
  hooks: Map<string, (event: { payload: unknown }) => { payload: unknown } | undefined>;
  emit(event: unknown): void;
}

const harnessInstances = AgentHarness as unknown as { instances: MockHarness[] };

function model(id: string, contextWindow: number): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "copilot-plus",
    baseUrl: "https://models.brevilabs.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: 8192,
  };
}

const KNOWN_MODELS = [model("gpt-5", 262_144), model("claude", 1_048_576)];

const models = {
  getModels: () => KNOWN_MODELS,
  getModel: (provider: string, id: string) =>
    KNOWN_MODELS.find((model) => model.provider === provider && model.id === id),
} as unknown as Models;

function assistantUsageEvent(overrides: Record<string, number> = {}) {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      usage: {
        input: 100,
        output: 20,
        cacheRead: 5,
        cacheWrite: 3,
        totalTokens: 128,
        ...overrides,
      },
    },
  };
}

function lastHarness(): MockHarness {
  const harness = harnessInstances.instances.at(-1);
  if (!harness) throw new Error("no harness constructed");
  return harness;
}

describe("engine", () => {
  beforeEach(() => {
    harnessInstances.instances.length = 0;
  });

  describe("createPiEngine()", () => {
    it("opens the harness on the requested model over an in-memory session", () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/claude" });

      expect(engine.getModelId()).toBe("copilot-plus/claude");
      expect(lastHarness().options.session).toBeDefined();
      expect(lastHarness().options.models).toBe(models);
    });

    it("passes the system prompt through as a fixed string so every turn sends identical leading context", () => {
      createPiEngine({ models, modelId: "gpt-5", systemPrompt: "be helpful" });

      expect(lastHarness().options.systemPrompt).toBe("be helpful");
    });

    it("rejects a model id no provider knows", () => {
      expect(() => createPiEngine({ models, modelId: "nope" })).toThrow(
        'No pi model registered with id "nope"'
      );
    });

    it("forwards prompt text and images to the harness", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });
      const images = [{ type: "image", data: "abc", mimeType: "image/png" }];

      await engine.prompt("hello", images as never);

      expect(lastHarness().prompt).toHaveBeenCalledWith("hello", { images });
    });

    it("waits for the run to settle after aborting", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });

      await engine.abort();

      expect(lastHarness().abort).toHaveBeenCalledTimes(1);
      expect(lastHarness().waitForIdle).toHaveBeenCalledTimes(1);
    });

    it("switches to another known model and reports it", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });

      await engine.setModel("copilot-plus/claude");

      expect(engine.getModelId()).toBe("copilot-plus/claude");
    });

    it("rejects a switch to a model no provider knows", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });

      await expect(engine.setModel("nope")).rejects.toThrow(
        'No pi model registered with id "nope"'
      );
      expect(engine.getModelId()).toBe("copilot-plus/gpt-5");
    });

    it("summarizes the older conversation once a turn crowds the window", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });
      // 262144 - 16384 reserve = 245760; go past it.
      lastHarness().prompt.mockImplementationOnce(() => {
        lastHarness().emit(assistantUsageEvent({ totalTokens: 250_000 }));
        return Promise.resolve({});
      });

      await engine.prompt("hi");

      expect(lastHarness().compact).toHaveBeenCalledTimes(1);
    });

    it("leaves a comfortable conversation uncompacted", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });
      lastHarness().prompt.mockImplementationOnce(() => {
        lastHarness().emit(assistantUsageEvent({ totalTokens: 1000 }));
        return Promise.resolve({});
      });

      await engine.prompt("hi");

      expect(lastHarness().compact).not.toHaveBeenCalled();
    });

    it("keeps answering when compaction itself fails", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });
      lastHarness().prompt.mockImplementationOnce(() => {
        lastHarness().emit(assistantUsageEvent({ totalTokens: 250_000 }));
        return Promise.resolve({});
      });
      lastHarness().compact.mockRejectedValueOnce(new Error("summary failed"));

      await expect(engine.prompt("hi")).resolves.toBeUndefined();
    });

    it("stamps provider requests with the conversation's cache key when given one", () => {
      createPiEngine({ models, modelId: "copilot-plus/gpt-5", cacheKey: "session-7" });

      const hook = lastHarness().hooks.get("before_provider_payload");

      expect(hook?.({ payload: { messages: [] } })).toEqual({
        payload: { messages: [], prompt_cache_key: "session-7" },
      });
    });

    it("sends no cache key when the caller supplies none", () => {
      createPiEngine({ models, modelId: "copilot-plus/gpt-5" });

      expect(lastHarness().hooks.has("before_provider_payload")).toBe(false);
    });

    it("delegates compaction to the harness", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });

      await engine.compact();

      expect(lastHarness().compact).toHaveBeenCalledTimes(1);
    });

    it("delivers conversation events to subscribers and stops on unsubscribe", () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });
      const received: AgentEvent[] = [];
      const unsubscribe = engine.subscribe((event) => received.push(event));

      lastHarness().emit({ type: "message_update", message: {}, assistantMessageEvent: {} });
      unsubscribe();
      lastHarness().emit({ type: "message_end", message: {} });

      expect(received.map((event) => event.type)).toEqual(["message_update"]);
    });

    it("hides harness lifecycle events that are not part of pi's conversation event union", () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });
      const received: AgentEvent[] = [];
      engine.subscribe((event) => received.push(event));

      lastHarness().emit({ type: "before_provider_request" });
      lastHarness().emit({ type: "settled" });
      lastHarness().emit({ type: "turn_end", message: {}, toolResults: [] });

      expect(received.map((event) => event.type)).toEqual(["turn_end"]);
    });

    it("reports zero usage against the active model's context window before any response", () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/claude" });

      expect(engine.usage()).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        contextTokens: 0,
        contextWindow: 1_048_576,
      });
    });

    it("reports the most recent assistant usage and tracks the context window across model switches", async () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });

      lastHarness().emit(assistantUsageEvent());
      expect(engine.usage()).toEqual({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        contextTokens: 128,
        contextWindow: 262_144,
      });

      lastHarness().emit(assistantUsageEvent({ input: 200, totalTokens: 0 }));
      await engine.setModel("copilot-plus/claude");

      expect(engine.usage()).toMatchObject({
        inputTokens: 200,
        contextTokens: 228,
        contextWindow: 1_048_576,
      });
    });

    it("ignores usage on messages the model did not produce", () => {
      const engine = createPiEngine({ models, modelId: "copilot-plus/gpt-5" });

      lastHarness().emit({ type: "message_end", message: { role: "user", usage: { input: 9 } } });

      expect(engine.usage().inputTokens).toBe(0);
    });
  });
});
