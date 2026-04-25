import { logInfo } from "@/logger";
import type CopilotPlugin from "@/main";
import { App, Platform } from "obsidian";

/**
 * M0 stub coordinator for Agent Mode. Lazily instantiated by main.ts on desktop
 * only. createSession / closeSession / shutdown are no-ops in M0; M2 fills them
 * in with backend spawn + ACP newSession + per-session lifecycle.
 */
export class AgentSessionManager {
  private static instance: AgentSessionManager | null = null;

  private constructor(
    private readonly app: App,
    private readonly plugin: CopilotPlugin
  ) {}

  static getInstance(app: App, plugin: CopilotPlugin): AgentSessionManager {
    if (Platform.isMobile) {
      throw new Error("AgentSessionManager is desktop only");
    }
    if (!AgentSessionManager.instance) {
      AgentSessionManager.instance = new AgentSessionManager(app, plugin);
    }
    return AgentSessionManager.instance;
  }

  /** Stub — fully implemented in M2. */
  async createSession(): Promise<void> {
    logInfo("[AgentMode] createSession() called (M0 stub)");
  }

  /** Stub — fully implemented in M3. */
  async closeSession(_id: string): Promise<void> {
    logInfo("[AgentMode] closeSession() called (M0 stub)");
  }

  /** Tear down everything. Safe to call when nothing was started. */
  async shutdown(): Promise<void> {
    logInfo("[AgentMode] shutdown() called (M0 stub)");
    AgentSessionManager.instance = null;
  }
}
