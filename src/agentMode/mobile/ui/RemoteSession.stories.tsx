import { RemoteSession } from "@/agentMode/mobile/ui/RemoteSession";
import type { RemoteSessionRuntime } from "@/agentMode/mobile/remoteSessionRuntime";
import type { LinkState, RemoteSessionTransport } from "@/agentMode/mobile/RemoteSessionTransport";
import type { HostState, WireMessage } from "@/agentMode/protocol/state";
import {
  createFixtureClient,
  createFixtureDraftStore,
  createFixtureView,
  fixtureBackend,
  fixtureTab,
} from "@/agentMode/ui/agentPane.fixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useMemo } from "react";

interface RemoteSessionScenario {
  tabs: HostState["tabs"];
  transcript: WireMessage[];
}

const SESSION_ID = "gallery-remote-session";
const OPEN_LINK: LinkState = { phase: "open", failure: null, attempts: 0 };

const transcript: WireMessage[] = [
  {
    id: "u1",
    sender: "user",
    message: "Summarize the launch notes from this morning.",
    timestamp: { epoch: Date.now(), display: "", fileName: "" },
    isVisible: true,
  },
  {
    id: "a1",
    sender: "AI",
    message:
      "Three decisions came out of the meeting: ship on Friday, hold the pricing change, and start the beta list.",
    timestamp: { epoch: Date.now(), display: "", fileName: "" },
    isVisible: true,
  },
];

// The phone's assembled pane over a scripted desktop; the gallery's width toolbar sets the phone width.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/613
const RemoteSessionDemo: React.FC<{ scenario: RemoteSessionScenario }> = ({ scenario }) => {
  const app = useApp();
  const runtime = useMemo<RemoteSessionRuntime>(() => {
    const fixture = createFixtureClient({
      sessionId: SESSION_ID,
      host: {
        tabs: scenario.tabs,
        backends: [fixtureBackend({ id: "claude", displayName: "Claude Code" })],
      },
      session: { transcript: scenario.transcript },
    });
    return {
      client: fixture.client,
      view: createFixtureView(fixture, SESSION_ID),
      transport: {
        getLinkState: () => OPEN_LINK,
        subscribeLink: () => () => {},
        reconnectNow: () => {},
      } as unknown as RemoteSessionTransport,
      drafts: createFixtureDraftStore(app),
      capabilities: { vaultBase: null, multiAgentAllowed: true },
      dispose: () => {},
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a story renders one scenario for its lifetime
  }, []);

  return (
    <TooltipProvider>
      <div className="tw-flex tw-h-[640px] tw-flex-col tw-overflow-hidden">
        <RemoteSession
          runtime={runtime}
          app={app}
          desktopName="Studio Mac"
          appVersion="4.1.0"
          updateUserMessageHistory={() => {}}
        />
      </div>
    </TooltipProvider>
  );
};

const meta = {
  title: "Agent Mode/Remote/Remote Session",
  component: RemoteSessionDemo,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<{ scenario: RemoteSessionScenario }>;
export default meta;

export const ActiveChat: StoryObj<{ scenario: RemoteSessionScenario }> = {
  args: { scenario: { tabs: [fixtureTab({ id: SESSION_ID, label: "Launch notes" })], transcript } },
};

export const NoSessionsOnTheDesktop: StoryObj<{ scenario: RemoteSessionScenario }> = {
  args: { scenario: { tabs: [], transcript: [] } },
};
