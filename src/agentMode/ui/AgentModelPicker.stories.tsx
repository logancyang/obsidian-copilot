import type { BackendSummary } from "@/agentMode/protocol/state";
import type { BackendState } from "@/agentMode/session/types";
import {
  createFixtureClient,
  createFixtureView,
  fixtureBackend,
} from "@/agentMode/ui/agentPane.fixtures";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import { ModelEffortPicker } from "@/components/ui/ModelEffortPicker";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useMemo } from "react";

const claudeState: BackendState = {
  model: {
    current: { baseModelId: "opus", effort: "high" },
    availableModels: [
      {
        baseModelId: "opus",
        name: "Opus",
        provider: null,
        effortOptions: [
          { value: "low", label: "Low" },
          { value: "high", label: "High" },
        ],
      },
    ],
    apply: { kind: "setModel" },
  },
  mode: null,
};

const claude = fixtureBackend({
  id: "claude",
  displayName: "Claude Code",
  enabled: [
    { baseModelId: "opus", name: "Opus", missingKey: false },
    { baseModelId: "haiku", name: "Haiku", missingKey: false },
  ],
  reported: [
    { baseModelId: "opus", name: "Opus", description: "Deep reasoning" },
    { baseModelId: "haiku", name: "Haiku", description: "Fast answers" },
  ],
  efforts: {
    opus: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
  },
});

const PickerDemo: React.FC<{ others: BackendSummary[] }> = ({ others }) => {
  const { client, view } = useMemo(() => {
    const fixture = createFixtureClient({
      sessionId: "s1",
      tab: { backendId: "claude" },
      host: { backends: [claude, ...others] },
      session: { backendState: claudeState },
    });
    return { client: fixture.client, view: createFixtureView(fixture, "s1") };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a story renders one scenario for its lifetime
  }, []);
  const override = useAgentModelPicker(client, view);
  if (!override?.effortOptionsByModelKey || !override.commitSelection) return null;
  return (
    <TooltipProvider>
      <ModelEffortPicker
        override={{
          models: override.models,
          value: override.value,
          effort: override.effort,
          effortOptionsByModelKey: override.effortOptionsByModelKey,
          commitSelection: override.commitSelection,
        }}
      />
    </TooltipProvider>
  );
};

const story = (others: BackendSummary[]): StoryObj => ({
  render: () => <PickerDemo others={others} />,
});

const meta = {
  title: "Agent Mode/Agent Model Picker",
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta;
export default meta;

export const ReadyAgents: StoryObj = story([
  fixtureBackend({
    id: "codex",
    displayName: "Codex",
    enabled: [{ baseModelId: "gpt", name: "GPT", missingKey: false }],
    reported: [{ baseModelId: "gpt", name: "GPT" }],
  }),
]);

export const AgentNotSetUp: StoryObj = story([
  fixtureBackend({
    id: "codex",
    displayName: "Codex",
    readiness: "not_set_up",
    enabled: [{ baseModelId: "gpt", name: "GPT", missingKey: false }],
    reported: [{ baseModelId: "gpt", name: "GPT" }],
  }),
]);

export const AgentLoadingModels: StoryObj = story([
  fixtureBackend({
    id: "codex",
    displayName: "Codex",
    enabled: [{ baseModelId: "gpt", name: "GPT", missingKey: false }],
    reported: null,
    preload: "pending",
  }),
]);
