import type { CustomModel } from "@/aiParams";
import { AgentQuickChatModel, type QuickChatAgentManager } from "./AgentQuickChatModel";

/** Lifecycle-owned factory that exposes bound Agent processes to Quick Chat. */
export class AgentQuickChatBridge {
  private disposed = false;

  constructor(
    private readonly manager: QuickChatAgentManager,
    private readonly cwd: string
  ) {}

  createModel(model: CustomModel): AgentQuickChatModel {
    if (this.disposed) throw new Error("Agent Quick Chat bridge is disposed.");
    if (!model.agentType)
      throw new Error("Cannot create an Agent Quick Chat model without agentType.");
    return new AgentQuickChatModel(this.manager, model, this.cwd);
  }

  dispose(): void {
    this.disposed = true;
  }
}
