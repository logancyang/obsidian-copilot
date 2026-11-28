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
  readonly chats = new Map<string, HostChat>();
  readonly listeners = new Set<() => void>();

  constructor(chats: Record<string, HostChat> = {}) {
    for (const [id, chat] of Object.entries(chats)) this.chats.set(id, chat);
  }

  getSession(id: string): HostChat | null {
    return this.chats.get(id) ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(id: string): void {
    this.chats.delete(id);
    for (const listener of this.listeners) listener();
  }
}
