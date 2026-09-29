import {
  RemoteSessionTransport,
  type VisibilitySource,
} from "@/agentMode/mobile/RemoteSessionTransport";
import { createPhonePaneCapabilities } from "@/agentMode/mobile/phonePaneCapabilities";
import { ClientView } from "@/agentMode/protocol/ClientView";
import { SessionClient } from "@/agentMode/protocol/SessionClient";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { AgentInputDraftStore } from "@/agentMode/session/AgentInputDraftStore";
import type { AgentPaneCapabilities } from "@/agentMode/ui/AgentPaneContext";
import { logInfo } from "@/logger";
import type { PairedDesktop } from "@/remote/client/PairedDesktopStore";
import type { RemoteClient } from "@/remote/client/RemoteClient";
import { trackRemoteEvent } from "@/remote/remoteEvents";
import type { App } from "obsidian";

export interface RemoteSessionRuntime {
  client: SessionClient;
  view: ClientView;
  transport: RemoteSessionTransport;
  drafts: AgentInputDraftStore;
  capabilities: AgentPaneCapabilities;
  dispose(): void;
}

export interface RemoteSessionRuntimeDeps {
  app: App;
  remote: RemoteClient;
  desktop: PairedDesktop;
  appVersion: string;
  visibility: VisibilitySource;
}

export const documentVisibility: VisibilitySource = {
  isVisible: () => document.visibilityState !== "hidden",
  subscribe: (listener) => {
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
};

// One phone client for one paired desktop: the replica, this device's own view of the shared tab
// set, its composer drafts, and the link that keeps them current. The phone shows one tab, so it
// watches only that tab (the tab pane does it) and never every attached tab, and it tells the
// desktop it shows nothing while the app is in the background.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
export function createRemoteSessionRuntime(deps: RemoteSessionRuntimeDeps): RemoteSessionRuntime {
  const { app, remote, desktop, appVersion, visibility } = deps;
  const transport = new RemoteSessionTransport({
    connect: () => remote.connect(desktop),
    visibility,
  });
  const client = new SessionClient(transport, {
    app: appVersion,
    onDiagnostic: (diagnostic) =>
      logInfo(`[Remote] ${diagnostic.kind} on ${diagnostic.scope ?? "connection"}`),
  });
  const view = new ClientView(GLOBAL_SCOPE);
  const stopView = view.attach(client);
  const drafts = new AgentInputDraftStore(
    app,
    (chatInputId) => client.getHost()?.tabs.some((tab) => tab.chatInputId === chatInputId) ?? false
  );

  let lastHost = client.getHost();
  let opened = false;
  const stopClient = client.subscribe(() => {
    const host = client.getHost();
    if (host !== lastHost) {
      lastHost = host;
      drafts.prune();
    }
    // The phone has no home screen to fall back to, so a view left without a tab (the desktop
    // restarted, or closed every tab) shows the next tab that appears instead of offering to start
    // a session beside tabs that exist.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/613
    if (view.getActiveTabId() === null) {
      const adopted = host?.tabs.filter((tab) => tab.projectId === view.getProjectScope()).at(-1);
      if (adopted) view.activate(adopted);
    }
    if (!opened && client.getConnection() === "live") {
      opened = true;
      trackRemoteEvent({ name: "remote_session_opened", role: "phone" });
    }
  });
  const stopVisibility = visibility.subscribe(() => {
    client.setFocus(visibility.isVisible() ? view.getActiveTabId() : null);
  });

  transport.start();
  return {
    client,
    view,
    transport,
    drafts,
    capabilities: createPhonePaneCapabilities(client),
    dispose() {
      stopVisibility();
      stopClient();
      stopView();
      client.dispose();
    },
  };
}
