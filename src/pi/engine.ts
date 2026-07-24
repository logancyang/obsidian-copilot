import { logWarn } from "@/logger";
import { shouldCompactNow } from "@/pi/compaction";
import { installPromptCacheKey } from "@/pi/promptCache";
import type { PiEngineOptions, PiUsage } from "@/pi/types";
import type { PiToolContext } from "@/pi/tools";
import {
  AgentHarness,
  InMemorySessionStorage,
  Session,
  calculateContextTokens,
  type AgentEvent,
  type AgentHarnessEvent,
} from "@earendil-works/pi-agent-core";
import type { Api, ImageContent, Model, Models, Usage } from "@earendil-works/pi-ai";

/**
 * pi's harness also emits its own lifecycle events; only the conversation
 * events are part of this module's contract, so the rest are filtered out.
 */
const AGENT_EVENT_TYPES: ReadonlySet<string> = new Set<AgentEvent["type"]>([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

/**
 * A single streamed conversation with one pi model. The engine owns the
 * harness, its in-memory session, and the last reported token usage; it does
 * not know about Obsidian, chat history persistence, or tools.
 */
export interface PiEngine {
  prompt(text: string, images?: ImageContent[]): Promise<void>;
  abort(): Promise<void>;
  setModel(id: string): Promise<void>;
  getModelId(): string;
  subscribe(fn: (e: AgentEvent) => void): () => void;
  compact(): Promise<void>;
  usage(): PiUsage;
}

function isAgentEvent(event: AgentHarnessEvent): event is AgentEvent {
  return AGENT_EVENT_TYPES.has(event.type);
}

function requireModel(models: Models, id: string): Model<Api> {
  const model = models.getModels().find((candidate) => candidate.id === id);
  if (!model) throw new Error(`No pi model registered with id "${id}"`);
  return model;
}

function toPiUsage(usage: Usage | undefined, contextWindow: number): PiUsage {
  return {
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cacheReadTokens: usage?.cacheRead ?? 0,
    cacheWriteTokens: usage?.cacheWrite ?? 0,
    contextTokens: usage ? calculateContextTokens(usage) : 0,
    contextWindow,
  };
}

/**
 * Starts a conversation on the given model collection.
 *
 * @param options the provider collection, the model to open on, and an optional
 * system prompt. The prompt is passed as a fixed string rather than a callback
 * so every turn sends byte-identical leading context and stays cacheable.
 */
export function createPiEngine(options: PiEngineOptions): PiEngine {
  const harness = new AgentHarness<PiToolContext | undefined>({
    session: options.session ?? new Session(new InMemorySessionStorage()),
    models: options.models,
    model: requireModel(options.models, options.modelId),
    systemPrompt: options.systemPrompt,
    tools: options.tools ? [...options.tools] : undefined,
    toolContext: options.toolContext,
  });

  let lastUsage: Usage | undefined;
  harness.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      lastUsage = event.message.usage;
    }
  });

  if (options.cacheKey) installPromptCacheKey(harness, options.cacheKey);

  const currentUsage = (): PiUsage => toPiUsage(lastUsage, harness.getModel().contextWindow);

  /**
   * Summarize the older part of the conversation once it crowds the model's
   * window. Runs after the turn settles rather than during it, so the user
   * never waits on a summary mid-answer; a failure is reported and the next
   * turn simply tries again.
   */
  const compactIfNeeded = async (): Promise<void> => {
    if (!shouldCompactNow(currentUsage())) return;
    try {
      await harness.compact();
    } catch (error) {
      logWarn("[Pi] compaction failed; continuing without it", error);
    }
  };

  return {
    prompt: async (text, images) => {
      await harness.prompt(text, { images });
      await compactIfNeeded();
    },
    abort: async () => {
      await harness.abort();
      await harness.waitForIdle();
    },
    setModel: async (id) => {
      await harness.setModel(requireModel(options.models, id));
    },
    getModelId: () => harness.getModel().id,
    subscribe: (fn) =>
      harness.subscribe((event) => {
        if (isAgentEvent(event)) fn(event);
      }),
    compact: async () => {
      await harness.compact();
    },
    usage: currentUsage,
  };
}
