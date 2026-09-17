import { FanoutTurnView } from "@/agentMode/ui/FanoutTurnView";
import { FANOUT_SUMMARY_OPTION } from "@/agentMode/ui/fanoutDropdown";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type Props = React.ComponentProps<typeof FanoutTurnView>;

const meta = {
  title: "Agent/Fanout Turn",
  component: FanoutTurnView,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

const jennifer = {
  agentSlug: "jennifer",
  name: "Jennifer",
  icon: "🪶",
  status: "done" as const,
  text: "**Grid Notes** is the stronger title. It is shorter, it reads as a person's\nnotebook rather than a corporate brief, and it leaves room to widen the beat.",
};

const vancat = {
  agentSlug: "vancat",
  name: "Vancat",
  icon: "🐱",
  status: "done" as const,
  text: "Vancat here! Both titles have real upside — *The Storage Brief* promises\nsomething specific every week, which is exactly what a new reader wants.",
};

export const AgentAnswers: StoryObj<Props> = {
  render: function AgentAnswersStory(args) {
    return (
      <FanoutTurnView
        turn={args.turn!}
        value={args.value!}
        onSelect={args.onSelect!}
        app={useApp()}
      />
    );
  },
  args: {
    value: FANOUT_SUMMARY_OPTION,
    onSelect: () => {},
    turn: {
      answers: { jennifer, vancat },
      summary: {
        status: "done",
        text: "Jennifer argues for **Grid Notes** on voice and room to grow; Vancat likes\n**The Storage Brief** for the weekly promise it makes the reader.",
      },
    },
  },
};

export const AgentStillAnswering: StoryObj<Props> = {
  render: AgentAnswers.render,
  args: {
    ...AgentAnswers.args,
    value: "vancat",
    turn: {
      answers: { jennifer, vancat: { ...vancat, status: "running", text: "Vancat here! " } },
      summary: { status: "pending", text: "" },
    },
  },
};

export const SingleAgentAnswer: StoryObj<Props> = {
  render: AgentAnswers.render,
  args: {
    value: "jennifer",
    onSelect: () => {},
    turn: { answers: { jennifer }, summary: { status: "done", text: "" } },
  },
};

export const SummarySetupError: StoryObj<Props> = {
  render: AgentAnswers.render,
  args: {
    value: FANOUT_SUMMARY_OPTION,
    onSelect: () => {},
    turn: {
      answers: { jennifer, vancat },
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
  render: AgentAnswers.render,
  args: {
    ...SummarySetupError.args,
    turn: {
      answers: { jennifer, vancat },
      summary: {
        status: "done",
        text: "Jennifer argues for **Grid Notes**.",
        error: "The summary request timed out.",
      },
    },
  },
};

export const MissingAgent: StoryObj<Props> = {
  render: AgentAnswers.render,
  args: {
    value: "rafa",
    onSelect: () => {},
    turn: {
      answers: {
        jennifer,
        rafa: {
          agentSlug: "rafa",
          name: "Rafa",
          icon: "",
          status: "error",
          text: "",
          error: "This agent no longer exists.",
        },
      },
      summary: { status: "done", text: "Only Jennifer answered this turn." },
    },
  },
};
