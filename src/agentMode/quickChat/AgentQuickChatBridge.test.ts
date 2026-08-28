import type { CustomModel } from "@/aiParams";
import { AgentQuickChatBridge } from "./AgentQuickChatBridge";
import { AgentQuickChatModel } from "./AgentQuickChatModel";

describe("AgentQuickChatBridge", () => {
  it("creates a LangChain model for each bound Agent origin", () => {
    const manager = { ensureBackendProcess: jest.fn() };
    const bridge = new AgentQuickChatBridge(manager, "C:\\vault");
    const model = { name: "gpt-5", agentType: "codex" } as CustomModel;

    expect(bridge.createModel(model)).toBeInstanceOf(AgentQuickChatModel);
  });

  it("rejects model creation after disposal", () => {
    const bridge = new AgentQuickChatBridge({ ensureBackendProcess: jest.fn() }, "C:\\vault");
    bridge.dispose();

    expect(() => bridge.createModel({ name: "gpt-5", agentType: "codex" } as CustomModel)).toThrow(
      "disposed"
    );
  });
});
