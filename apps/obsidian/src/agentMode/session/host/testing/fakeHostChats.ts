import type { AgentSessionListener } from "@/agentMode/session/AgentSession";
import type { HostChat, HostChats } from "@/agentMode/session/host/SessionHost";
import type { PlanUsage } from "@copilot/protocol/planUsage";
import type { SessionUsage } from "@copilot/protocol/sessionUsage";

export class FakeHostChat implements HostChat {
  readonly listeners = new Set<AgentSessionListener>();

  constructor(
    private usage: SessionUsage | null = null,
    private planUsage: PlanUsage | null = null
  ) {}

  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSessionUsage(): SessionUsage | null {
    return this.usage;
  }

  getPlanUsage(): PlanUsage | null {
    return this.planUsage;
  }

  change(next: { usage?: SessionUsage | null; planUsage?: PlanUsage | null }): void {
    if (next.usage !== undefined) this.usage = next.usage;
    if (next.planUsage !== undefined) this.planUsage = next.planUsage;
    for (const listener of this.listeners) listener.onMessagesChanged();
  }
}

export class FakeHostChats implements HostChats {
  constructor(private readonly chats: Record<string, HostChat> = {}) {}

  getSession(id: string): HostChat | null {
    return this.chats[id] ?? null;
  }
}
