import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";
import { FANOUT_SUMMARY_OPTION } from "@/agentMode/ui/fanoutDropdown";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

type Props = React.ComponentProps<typeof FanoutTurnView>;

const meta = {
  title: "Agent/Fanout Turn",
  component: FanoutTurnView,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const SummarySetupError: StoryObj<Props> = {
  render: function SummaryStory(args) {
    const [value, setValue] = useState(args.value ?? FANOUT_SUMMARY_OPTION);
    return <FanoutTurnView turn={args.turn!} value={value} onSelect={setValue} app={useApp()} />;
  },
  args: {
    value: FANOUT_SUMMARY_OPTION,
    turn: {
      answers: {
        codex: { backendId: "codex", status: "done", text: "The notes support a weekly review." },
      },
      summary: {
        status: "done",
        text: "",
        error:
          "This Codex adapter cannot choose effort for a model-only switch. Choose an explicit effort or update the Codex adapter.",
      },
    },
  },
};

export const PartialSummaryError: StoryObj<Props> = {
  render: SummarySetupError.render,
  args: {
    ...SummarySetupError.args,
    turn: {
      ...SummarySetupError.args!.turn!,
      summary: {
        status: "done",
        text: "Both agents recommend a weekly review.",
        error: "The summary request timed out.",
      },
    },
  },
};
