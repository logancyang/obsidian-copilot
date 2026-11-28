import type { AgentChatMessage } from "@/agentMode/session/types";
import { TaskOutputReaderContext } from "@/agentMode/ui/hooks/useTaskOutputTail";
import { COMMAND_OUTPUT_MAX_BYTES, TaskDetailView } from "@/agentMode/ui/TaskDetailView";
import { makeCommandTask, makeTask, textOutputReader } from "@/agentMode/ui/testing/taskFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type Props = React.ComponentProps<typeof TaskDetailView>;

const PROGRESS = Array.from({ length: 18 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const LONG_LINE = "render: encoded segment with 2400 frames at 60fps, writing to out/launch.mp4\n";
const OUTPUT_READER = textOutputReader({
  "/tmp/tasks/live.output": PROGRESS,
  "/tmp/tasks/done.output": PROGRESS + "line 19\nline 20\n",
  "/tmp/tasks/long.output": LONG_LINE.repeat(
    Math.ceil(COMMAND_OUTPUT_MAX_BYTES / LONG_LINE.length) + 50
  ),
});

const SUBAGENT_MESSAGES: AgentChatMessage[] = [
  {
    id: "m1",
    sender: "ai",
    timestamp: null,
    isVisible: true,
    message: "",
    parts: [
      { kind: "thought", text: "I need to wait first, then count the words.", durationMs: 1800 },
      {
        kind: "tool_call",
        id: "t1",
        title: "Bash: perl -e 'select(undef,undef,undef,20)'",
        status: "completed",
        vendorToolName: "Bash",
        toolKind: "execute",
        input: {
          command: "perl -e 'select(undef,undef,undef,20)'",
          description: "Wait 20 seconds",
        },
      },
      {
        kind: "tool_call",
        id: "t2",
        title: "Bash: wc -w Welcome.md",
        status: "completed",
        vendorToolName: "Bash",
        toolKind: "execute",
        input: { command: "wc -w Welcome.md", description: "Count words in Welcome.md" },
        output: [{ type: "text", text: "       9 Welcome.md" }],
      },
      {
        kind: "text",
        text: "I waited 20 seconds, then `wc -w` reported that Welcome.md has **9 words**.",
      },
    ],
  },
];

const RUNNING_MESSAGES: AgentChatMessage[] = [
  {
    ...SUBAGENT_MESSAGES[0],
    parts: [
      { kind: "thought", text: "I need to wait first, then count the words.", durationMs: 1800 },
      {
        kind: "tool_call",
        id: "t1",
        title: "Bash: perl -e 'select(undef,undef,undef,20)'",
        status: "in_progress",
        vendorToolName: "Bash",
        toolKind: "execute",
        input: {
          command: "perl -e 'select(undef,undef,undef,20)'",
          description: "Wait 20 seconds",
        },
      },
    ],
  },
];

const EDITING_MESSAGES: AgentChatMessage[] = [
  {
    id: "m2",
    sender: "ai",
    timestamp: null,
    isVisible: true,
    message: "",
    parts: [
      {
        kind: "tool_call",
        id: "e1",
        title: "Edit: Projects/Launch plan.md",
        status: "completed",
        vendorToolName: "Edit",
        toolKind: "edit",
        locations: [{ path: "Projects/Launch plan.md" }],
      },
      {
        kind: "tool_call",
        id: "e2",
        title: "Write: Projects/Launch checklist.md",
        status: "completed",
        vendorToolName: "Write",
        toolKind: "edit",
        locations: [{ path: "Projects/Launch checklist.md" }],
      },
      {
        kind: "text",
        text: "I moved the launch to **May 12** in the plan and added a checklist note.",
      },
    ],
    fileChanges: [
      {
        path: "Projects/Launch plan.md",
        status: "modified",
        before: "# Launch plan\n\nShip on May 5.\n",
        after: "# Launch plan\n\nShip on May 12.\nSee the checklist.\n",
        additions: 2,
        deletions: 1,
      },
      {
        path: "Projects/Launch checklist.md",
        status: "created",
        before: null,
        after: "- [ ] Freeze copy\n- [ ] Record the demo\n- [ ] Publish the post\n",
        additions: 3,
        deletions: 0,
      },
    ],
  },
];

const SUBAGENT = makeTask({
  prompt:
    "Run the Bash command perl -e 'select(undef,undef,undef,20)' and then run wc -w Welcome.md, and reply with the word count.",
  model: "claude-haiku-4-5",
});

const NO_OP = () => {};

const Demo: React.FC<Partial<Props>> = ({
  task = SUBAGENT,
  messages = SUBAGENT_MESSAGES,
  onBack = NO_OP,
  status,
  chatAwaitsAnswer,
}) => {
  const app = useApp();
  return (
    <TaskOutputReaderContext.Provider value={OUTPUT_READER}>
      <TooltipProvider>
        <div className="tw-flex tw-h-[480px] tw-flex-col">
          <TaskDetailView
            task={task}
            status={status}
            messages={messages}
            app={app}
            onBack={onBack}
            chatAwaitsAnswer={chatAwaitsAnswer}
          />
        </div>
      </TooltipProvider>
    </TaskOutputReaderContext.Provider>
  );
};

const meta = {
  title: "Agent Mode/Task Detail",
  component: TaskDetailView,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<Props>;
export default meta;

export const SubagentRunning: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: { messages: RUNNING_MESSAGES },
};

export const SubagentStarting: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: { task: { ...SUBAGENT, taskId: undefined, model: undefined }, messages: [] },
};

export const ChatAwaitsAnswer: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: { messages: RUNNING_MESSAGES, status: "needs_approval", chatAwaitsAnswer: true },
};

export const SubagentFinished: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: { task: { ...SUBAGENT, status: "completed" } },
};

export const SubagentReportFromNotification: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: {
    task: {
      ...SUBAGENT,
      status: "completed",
      summary: "Welcome.md has **9 words**. The vault's other top-level notes are empty templates.",
    },
    messages: [],
  },
};

export const SubagentFinishedWithFileChanges: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: {
    task: makeTask({
      description: "Move the launch date",
      prompt: "Move the launch in Projects/Launch plan.md to May 12 and add a checklist note.",
      model: "claude-haiku-4-5",
      status: "completed",
    }),
    messages: EDITING_MESSAGES,
  },
};

export const CommandLive: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: { task: makeCommandTask({ outputFile: "/tmp/tasks/live.output" }), messages: [] },
};

export const CommandFinished: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: {
    task: makeCommandTask({ status: "completed", outputFile: "/tmp/tasks/done.output" }),
    messages: [],
  },
};

export const CommandTruncated: StoryObj<Props> = {
  render: (args) => <Demo {...args} />,
  args: {
    task: makeCommandTask({
      description: "Render the launch video",
      command: "npm run render -- --out out/launch.mp4",
      status: "completed",
      outputFile: "/tmp/tasks/long.output",
    }),
    messages: [],
  },
};
