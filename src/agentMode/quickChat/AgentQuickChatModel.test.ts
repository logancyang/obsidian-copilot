import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { CustomModel } from "@/aiParams";
import type { BackendProcess } from "@/agentMode/session/types";
import { AgentQuickChatModel, serializeAgentQuickChatMessages } from "./AgentQuickChatModel";

describe("serializeAgentQuickChatMessages", () => {
  it("preserves system, user, and assistant turns as one agent prompt", () => {
    expect(
      serializeAgentQuickChatMessages([
        new SystemMessage("You are a helpful vault assistant."),
        new HumanMessage("Summarize this note."),
        new AIMessage("The note is about project planning."),
      ])
    ).toBe(
      [
        "[system]",
        "You are a helpful vault assistant.",
        "",
        "[user]",
        "Summarize this note.",
        "",
        "[assistant]",
        "The note is about project planning.",
      ].join("\n")
    );
  });

  it("extracts text from structured content and labels non-text messages", () => {
    const message = new HumanMessage({
      content: [
        { type: "text", text: "Read this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
      ],
    });
    expect(
      serializeAgentQuickChatMessages([
        message,
        { _getType: () => "tool", getType: () => "tool", content: "tool output" } as never,
      ])
    ).toContain("[user]\nRead this\n[image_url content omitted]\n\n[tool]\ntool output");
  });

  it("streams text from the bound Agent backend into LangChain chunks", async () => {
    const handlers = new Map<string, (event: never) => void>();
    const backend = {
      newSession: jest.fn(async () => ({
        sessionId: "session-1",
        state: {
          model: {
            current: { baseModelId: "gemini-2.5-pro", effort: null },
            availableModels: [],
            apply: { kind: "setModel" },
          },
          mode: null,
        },
      })),
      registerSessionHandler: jest.fn((id: string, handler: (event: never) => void) => {
        handlers.set(id, handler);
        return () => handlers.delete(id);
      }),
      prompt: jest.fn(async () => {
        const handler = handlers.get("session-1");
        handler?.({
          sessionId: "session-1",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello" },
          },
        } as never);
        return { stopReason: "end_turn" as const };
      }),
      setSessionModel: jest.fn(),
      cancel: jest.fn(),
    } as unknown as BackendProcess;
    const manager = {
      ensureBackendProcess: jest.fn(async () => backend),
    };
    const model = new AgentQuickChatModel(
      manager,
      {
        name: "gemini-2.5-pro",
        provider: "3rd party (openai-format)",
        agentType: "antigravity",
        requiresApiKey: false,
      } as CustomModel,
      "C:\\vault"
    );

    const chunks: string[] = [];
    for await (const chunk of await model.stream([new HumanMessage("Hi")])) {
      chunks.push(
        typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content)
      );
    }
    expect(chunks).toEqual(["Hello"]);
    expect(backend.prompt).toHaveBeenCalledWith({
      sessionId: "session-1",
      prompt: [{ type: "text", text: "[user]\nHi" }],
    });
  });
});
