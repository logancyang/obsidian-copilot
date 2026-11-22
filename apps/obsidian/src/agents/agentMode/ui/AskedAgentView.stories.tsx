import type { AgentChatMessage } from "@/agentMode/session/types";
import type { AgentMention } from "@/agents/agentMentions";
import { AskedAgentView, type AskedAgentViewProps } from "@/agents/agentMode/ui/AskedAgentView";
import { askedAgentChatFixture } from "@/agents/agentMode/ui/testing/askedAgentChatFixture";
import { COCO, LEO, LONG_NAMED_AGENT } from "@/agents/ui/testing/rosterFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type ViewProps = Omit<AskedAgentViewProps, "app" | "onBack">;

const ASKED_AT = new Date(2026, 10, 16, 10, 2).getTime();
const SENT_BACK_AT = new Date(2026, 10, 16, 10, 21).getTime();
const MINUTE = 60_000;

function at(epoch: number) {
  return { epoch, display: "", fileName: "" };
}

const ASKED: AgentChatMessage = {
  id: "asked",
  sender: "user",
  timestamp: at(ASKED_AT),
  isVisible: true,
  message:
    'Coco asked you this for the user, from another chat.\n\n<message from="Coco">\nZero wants October reconciled against the Mercury export. Flag anything that doesn\'t match.\nBooks: [[October books]] · Export: Finance/Mercury/2026-10.csv\n</message>',
};

const MATCHING: AgentChatMessage = {
  id: "matching",
  sender: "ai",
  timestamp: at(ASKED_AT + MINUTE),
  isVisible: true,
  message: "",
  parts: [
    {
      kind: "tool_call",
      id: "read-books",
      title: "Read October books.md",
      status: "completed",
      vendorToolName: "Read",
      toolKind: "read",
      locations: [{ path: "Finance/Books/October books.md" }],
    },
    {
      kind: "text",
      text: "Mercury has 214 transactions in October, the books have 211. Matching by date and amount.",
    },
  ],
};

const QUESTION: AgentChatMessage = {
  id: "question",
  sender: "ai",
  timestamp: at(ASKED_AT + 4 * MINUTE),
  isVisible: true,
  message: "",
  parts: [
    {
      kind: "text",
      text: "Three Stripe payouts dated Oct 29–31 land in Mercury on Nov 2. That's a judgment call about which month they belong to, so I asked.",
    },
  ],
};

const ANSWER: AgentChatMessage = {
  id: "answer",
  sender: "user",
  timestamp: at(ASKED_AT + 5 * MINUTE),
  isVisible: true,
  message:
    "Coco passed on the user's answer to your question.\n\n<answer from=\"user\">\nCount the three Stripe payouts in October. They're October sales.\n</answer>",
};

const DONE: AgentChatMessage = {
  id: "done",
  sender: "ai",
  timestamp: at(ASKED_AT + 12 * MINUTE),
  isVisible: true,
  message: "",
  parts: [
    {
      kind: "text",
      text: "October reconciles except three items. I listed them under “Unmatched” in [[October books]] and added Figma's billing contact to [[Vendors]].",
    },
  ],
  fileChanges: [
    {
      path: "Finance/Books/October books.md",
      status: "modified",
      before: "# October books\n",
      after: "# October books\n\n## Unmatched\n- Figma $1,200\n",
      additions: 3,
      deletions: 0,
    },
    {
      path: "Finance/Vendors.md",
      status: "modified",
      before: "# Vendors\n",
      after: "# Vendors\n\nFigma billing: billing@figma.com\n",
      additions: 2,
      deletions: 0,
    },
  ],
};

const SENT_BACK: AgentChatMessage = {
  id: "sent-back",
  sender: "user",
  timestamp: at(SENT_BACK_AT),
  isVisible: true,
  message:
    'Coco asked you this for the user, from another chat.\n\n<message from="Coco">\nSend Leo back to it: pick up where you stopped.\n</message>',
};

const PICKING_UP: AgentChatMessage = {
  id: "picking-up",
  sender: "ai",
  timestamp: at(SENT_BACK_AT + 8_000),
  isVisible: true,
  message: "",
  parts: [{ kind: "text", text: "Picking up at transaction 183." }],
};

const FAILED: AgentChatMessage = {
  id: "failed",
  sender: "ai",
  timestamp: at(ASKED_AT + 15_000),
  isVisible: true,
  isErrorMessage: true,
  message: "**Error:** The model is overloaded right now. Try again in a few minutes.",
  parts: [],
};

function run(change: Partial<AgentMention>): AgentMention {
  return {
    id: "run-1",
    agent: "leo",
    name: "Leo",
    status: "working",
    startedAt: Date.now() - 3 * MINUTE - 12_000,
    ...change,
  };
}

const View: React.FC<ViewProps> = (props) => (
  <TooltipProvider>
    <div className="tw-flex tw-h-[520px] tw-flex-col">
      <AskedAgentView {...props} app={useApp()} onBack={() => {}} />
    </div>
  </TooltipProvider>
);

const meta = {
  title: "Copilot Teammates/Asked Agent View",
  component: View,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
  args: {
    run: run({}),
    from: COCO.name,
    fromFaceSrc: COCO.faceSrc,
    faceSrc: LEO.faceSrc,
    chat: askedAgentChatFixture([ASKED, MATCHING], "running"),
  },
} satisfies Meta<ViewProps>;
export default meta;

export const Working: StoryObj<ViewProps> = {};

export const WaitingForYou: StoryObj<ViewProps> = {
  args: {
    run: run({ status: "question" }),
    chat: askedAgentChatFixture([ASKED, MATCHING, QUESTION], "idle"),
  },
};

export const NeedsYourOk: StoryObj<ViewProps> = {
  args: {
    run: run({ status: "permission" }),
    chat: askedAgentChatFixture([ASKED, MATCHING], "awaiting_permission"),
  },
};

export const Finished: StoryObj<ViewProps> = {
  args: {
    run: run({ status: "finished", startedAt: ASKED_AT }),
    chat: askedAgentChatFixture([ASKED, MATCHING, QUESTION, ANSWER, DONE], "idle"),
  },
};

export const Stopped: StoryObj<ViewProps> = {
  args: {
    run: run({
      status: "stopped",
      startedAt: ASKED_AT,
    }),
    chat: askedAgentChatFixture([ASKED, MATCHING], "idle"),
  },
};

export const ContinuedAt: StoryObj<ViewProps> = {
  args: {
    run: run({ id: "run-2", startedAt: Date.now() - 8_000 }),
    chat: askedAgentChatFixture(
      [ASKED, MATCHING, SENT_BACK, PICKING_UP],
      "running",
      new Map([
        [ASKED.id, ASKED_AT],
        [SENT_BACK.id, SENT_BACK_AT],
      ])
    ),
  },
};

export const DidntFinishWithAnError: StoryObj<ViewProps> = {
  args: {
    run: run({
      status: "didnt_finish",
      startedAt: ASKED_AT,
    }),
    chat: askedAgentChatFixture([ASKED, FAILED], "idle"),
  },
};

export const NoLongerAvailable: StoryObj<ViewProps> = {
  args: {
    run: run({ status: "didnt_finish" }),
    chat: null,
  },
};

export const SavedReplyAfterRestart: StoryObj<ViewProps> = {
  args: {
    run: run({ status: "finished", startedAt: ASKED_AT }),
    chat: null,
    replies: new Map([
      [
        "question",
        "Three Stripe payouts dated Oct 29–31 land in Mercury on Nov 2. Which month should they count in?",
      ],
      [
        "reply",
        "October reconciles except three items. I listed them under “Unmatched” in [[October books]] and added Figma's billing contact to [[Vendors]].",
      ],
    ]),
  },
};

export const FromACopilotChat: StoryObj<ViewProps> = {
  args: { from: "Copilot", fromFaceSrc: undefined },
};

export const LongNames: StoryObj<ViewProps> = {
  args: {
    run: run({ agent: LONG_NAMED_AGENT.slug, name: LONG_NAMED_AGENT.name }),
    from: "Coco the Quarterly Planning and Release Notes Assistant",
    faceSrc: LONG_NAMED_AGENT.faceSrc,
  },
};
