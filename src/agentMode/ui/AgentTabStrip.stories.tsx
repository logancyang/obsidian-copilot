import type { HostState } from "@/agentMode/protocol/state";
import { AgentPaneCapabilitiesProvider } from "@/agentMode/ui/AgentPaneContext";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import {
  createFixtureClient,
  createFixtureView,
  fixtureBackend,
  fixtureTab,
  inertPaneCapabilities,
} from "@/agentMode/ui/agentPane.fixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useMemo } from "react";

interface Scenario {
  tabs: HostState["tabs"];
  activeId: string;
  starting?: boolean;
}

const StripDemo: React.FC<{ scenario: Scenario }> = ({ scenario }) => {
  const { client, view } = useMemo(() => {
    const fixture = createFixtureClient({
      sessionId: scenario.activeId,
      host: {
        tabs: scenario.tabs,
        backends: [fixtureBackend({ id: "claude", displayName: "Claude Code" })],
        host: {
          defaultBackendId: null,
          startingBackendId: scenario.starting ? "claude" : null,
          startFailed: false,
        },
      },
    });
    return { client: fixture.client, view: createFixtureView(fixture, scenario.activeId) };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a story renders one scenario for its lifetime
  }, []);
  return (
    <TooltipProvider>
      <AgentPaneCapabilitiesProvider value={inertPaneCapabilities}>
        <div className="tw-w-full">
          <AgentTabStrip client={client} view={view} />
        </div>
      </AgentPaneCapabilitiesProvider>
    </TooltipProvider>
  );
};

const tab = (id: string, overrides: Partial<HostState["tabs"][number]> = {}) =>
  fixtureTab({ id, chatInputId: `in-${id}`, ...overrides });

const story = (scenario: Scenario): StoryObj => ({
  render: () => <StripDemo scenario={scenario} />,
});

const meta = {
  title: "Agent Mode/Agent Tab Strip",
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta;
export default meta;

export const Tabs: StoryObj = story({
  activeId: "a",
  tabs: [
    tab("a", { label: "Trip plan" }),
    tab("b", { label: "Meeting notes", status: "running" }),
    tab("c", { label: null, needsAttention: true }),
    tab("d", { label: "Broken", status: "error" }),
  ],
});

export const Overflow: StoryObj = story({
  activeId: "f",
  tabs: ["a", "b", "c", "d", "e", "f"].map((id) => tab(id, { label: `Chat ${id.toUpperCase()}` })),
});

export const Creating: StoryObj = story({
  activeId: "a",
  starting: true,
  tabs: [tab("a", { label: "Trip plan" })],
});
