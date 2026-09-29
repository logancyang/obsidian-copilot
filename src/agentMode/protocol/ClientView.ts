import type { SessionClient } from "@/agentMode/protocol/SessionClient";
import type { HostState } from "@/agentMode/protocol/state";
import type { ProjectScopeId } from "@/agentMode/session/scope";
import type { SessionId } from "@/agentMode/session/types";

export interface ViewTab {
  id: SessionId;
  projectId: ProjectScopeId;
  chatInputId?: string;
}

export interface ClientViewState {
  activeTabId: SessionId | null;
  projectScope: ProjectScopeId;
}

/**
 * The state one client keeps for itself: which tab it shows and which project scope that tab
 * belongs to. The host never reads it, so a session another client creates, closes or replaces
 * cannot move this client's visible tab. The desktop panel and the phone each hold one.
 * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
 */
export class ClientView {
  private state: ClientViewState;
  private readonly lastActive = new Map<ProjectScopeId, SessionId>();
  private lastTabs: readonly ViewTab[] | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(projectScope: ProjectScopeId) {
    this.state = { activeTabId: null, projectScope };
  }

  getState(): ClientViewState {
    return this.state;
  }

  getActiveTabId(): SessionId | null {
    return this.state.activeTabId;
  }

  getProjectScope(): ProjectScopeId {
    return this.state.projectScope;
  }

  getLastActive(scope: ProjectScopeId): SessionId | null {
    return this.lastActive.get(scope) ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  activate(tab: ViewTab): void {
    this.lastActive.set(tab.projectId, tab.id);
    this.set({ activeTabId: tab.id, projectScope: tab.projectId });
  }

  clearActive(): void {
    this.set({ ...this.state, activeTabId: null });
  }

  setProjectScope(projectScope: ProjectScopeId): void {
    this.set({ ...this.state, projectScope });
  }

  /**
   * Keeps the view valid as the shared tab set changes. The first tab set adopts the last tab of
   * the current scope. Later, when the shown tab leaves the set, the view moves to the tab that
   * replaced it (the same composer identity), else to the neighbor in the same scope, else to none.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
   */
  reconcile(host: HostState | null): void {
    if (host === null) return;
    const tabs: readonly ViewTab[] = host.tabs.map((tab) => ({
      id: tab.id,
      projectId: tab.projectId,
      chatInputId: tab.chatInputId,
    }));
    const previous = this.lastTabs;
    this.lastTabs = tabs;
    for (const [scope, id] of [...this.lastActive]) {
      const gone = previous?.some((tab) => tab.id === id) && !tabs.some((tab) => tab.id === id);
      if (gone) this.lastActive.delete(scope);
    }

    const { activeTabId, projectScope } = this.state;
    if (previous === null) {
      if (activeTabId !== null) return;
      const inScope = tabs.filter((tab) => tab.projectId === projectScope);
      const adopted = inScope.at(-1);
      if (adopted) this.activate(adopted);
      return;
    }
    if (activeTabId === null || tabs.some((tab) => tab.id === activeTabId)) return;
    const removed = previous.find((tab) => tab.id === activeTabId);
    if (!removed) return;
    const before = previous.filter((tab) => tab.projectId === removed.projectId);
    const after = tabs.filter((tab) => tab.projectId === removed.projectId);
    const closedAt = before.findIndex((tab) => tab.id === activeTabId);
    const replacement = tabs.find(
      (tab) => tab.chatInputId !== undefined && tab.chatInputId === removed.chatInputId
    );
    const next = replacement ?? after.at(Math.min(closedAt, after.length - 1)) ?? null;
    if (next) this.activate(next);
    else this.clearActive();
  }

  /**
   * Follows `client`'s tab set and tells the host which tab this client shows, so the host can
   * clear that tab's attention mark. Returns a function that stops both.
   * https://github.com/Brevilabs/obsidian-copilot-private/issues/612
   */
  attach(client: SessionClient): () => void {
    const stopClient = client.subscribe(() => this.reconcile(client.getHost()));
    const reportFocus = (): void => client.setFocus(this.state.activeTabId);
    const stopView = this.subscribe(reportFocus);
    this.reconcile(client.getHost());
    reportFocus();
    return () => {
      stopClient();
      stopView();
      client.setFocus(null);
    };
  }

  private set(next: ClientViewState): void {
    if (
      next.activeTabId === this.state.activeTabId &&
      next.projectScope === this.state.projectScope
    ) {
      return;
    }
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}
