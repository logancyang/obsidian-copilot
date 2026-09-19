import React, { type ComponentProps } from "react";
import { AgentModeChatRecovery } from "@/agentMode/ui/AgentModeChatRecovery";
import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import type { Meta, StoryObj } from "@/lib/story";

type Props = ComponentProps<typeof AgentModeChatRecovery>;
const meta = {
  title: "Agent Mode/Chat Recovery",
  component: AgentModeChatRecovery,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<Props>;
export default meta;

export const Upgrade = {
  args: {
    hasSourceChat: true,
    onCancel: () => undefined,
    controls: null,
    picker: {
      models: [
        {
          name: "saved",
          displayName: "Saved model",
          provider: "agent",
          enabled: true,
          _backendId: "example",
          _group: "Example agent",
        },
      ],
      value: "example:saved|agent",
      effortOptionsByModelKey: {},
      commitSelection: () => undefined,
    },
    children: (
      <AgentStatusCard
        tone="warning"
        summary="Agent upgrade required"
        message="The configured agent version is below the supported minimum. Upgrade it in Configure, or return to your open chat."
        action={{ label: "Configure", onClick: () => undefined }}
      />
    ),
  },
} satisfies StoryObj<Props>;
/** A session start is already in flight, so the pane shows the pending selection without accepting a new one. */
export const Starting = {
  args: {
    ...Upgrade.args,
    picker: { ...Upgrade.args.picker, disabled: true },
    children: <AgentStatusCard message="Starting the agent…" />,
  },
export const ColdStartup = {
  args: { ...Upgrade.args, hasSourceChat: false, onCancel: undefined },
} satisfies StoryObj<Props>;
export const StartupFailure = {
  args: {
    ...Upgrade.args,
    children: (
      <AgentStatusCard
        tone="error"
        message="The agent failed to start. Your model selection and unsent draft are retained."
        action={{ label: "Retry", onClick: () => undefined }}
      />
    ),
  },
} satisfies StoryObj<Props>;
