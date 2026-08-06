import { resolveAgentSelectCta, type AgentSelectRow } from "@/agentMode/ui/agentSelectModel";
import { AgentSelectView } from "@/agentMode/ui/AgentSelectView";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentSelectViewProps = React.ComponentProps<typeof AgentSelectView>;

const OPENCODE: AgentSelectRow = {
  id: "opencode",
  name: "opencode",
  description:
    "Copilot Plus models, or any model on your own provider key. Copilot can download and manage the binary for you.",
  status: "absent",
  recommended: true,
  statusMessage: null,
};

const CLAUDE: AgentSelectRow = {
  id: "claude",
  name: "Claude",
  description:
    "Anthropic models, billed to your Claude Code subscription. Runs the claude CLI already on your machine.",
  status: "absent",
  recommended: false,
  statusMessage: null,
};

const CODEX: AgentSelectRow = {
  id: "codex",
  name: "Codex",
  description:
    "OpenAI models, billed to your ChatGPT subscription. Runs the codex-acp adapter on your machine.",
  status: "absent",
  recommended: false,
  statusMessage: null,
};

const AgentSelectStory: React.FC<AgentSelectViewProps> = (args) => {
  const [selectedId, setSelectedId] = React.useState(args.selectedId);
  const selectedRow = args.rows.find((row) => row.id === selectedId) ?? args.rows[0];
  const cta = resolveAgentSelectCta(selectedRow);

  return (
    <AgentSelectView
      {...args}
      selectedId={selectedId}
      onSelect={setSelectedId}
      ctaLabel={cta.label}
      footerNote={cta.note}
      ctaDisabled={cta.action === "wait"}
    />
  );
};

const meta = {
  title: "Agent Mode/Agent Select View",
  component: AgentSelectView,
  args: {
    rows: [OPENCODE, CLAUDE, CODEX],
    selectedId: "opencode",
    onSelect: () => undefined,
    ctaLabel: "Configure",
    footerNote: "opencode isn't set up on this machine yet.",
    onCta: () => undefined,
  },
  render: (args) => <AgentSelectStory {...args} />,
  parameters: { gallery: { host: "leaf", layout: "padded", width: 300 } },
} satisfies Meta<AgentSelectViewProps>;
export default meta;

export const NothingSetUp: StoryObj<AgentSelectViewProps> = {
  args: {},
};

export const OpencodeConnected: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [{ ...OPENCODE, status: "connected" }, CLAUDE, CODEX],
  },
};

export const ClaudeChecking: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [OPENCODE, { ...CLAUDE, status: "checking" }, CODEX],
    selectedId: "claude",
  },
};

export const ClaudeUpdateRequired: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [
      { ...OPENCODE, status: "connected" },
      {
        ...CLAUDE,
        status: "outdated",
        statusMessage: "Claude 2.1.205 is not supported. Copilot requires 2.1.206 or newer.",
      },
      CODEX,
    ],
    selectedId: "claude",
  },
};

export const CodexError: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [
      OPENCODE,
      CLAUDE,
      {
        ...CODEX,
        status: "error",
        statusMessage: "Could not read the Codex binary at /usr/local/bin/codex-acp.",
      },
    ],
    selectedId: "codex",
  },
};

export const LongAgentName: StoryObj<AgentSelectViewProps> = {
  args: {
    rows: [
      {
        ...OPENCODE,
        name: "Very Long Local Agent Backend Name",
        description:
          "Runs every Copilot Plus model plus anything reachable on your own provider key, and Copilot will download, verify, and keep the managed binary up to date for you without leaving the vault.",
        status: "connected",
      },
      CLAUDE,
      CODEX,
    ],
  },
};
