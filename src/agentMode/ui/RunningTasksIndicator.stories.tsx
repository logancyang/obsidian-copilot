import type { PermissionPrompt } from "@/agentMode/session/types";
import { TaskOutputReaderContext } from "@/agentMode/ui/hooks/useTaskOutputTail";
import { RunningTasksIndicator } from "@/agentMode/ui/RunningTasksIndicator";
import { makeCommandTask, makeTask, textOutputReader } from "@/agentMode/ui/testing/taskFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type Props = React.ComponentProps<typeof RunningTasksIndicator>;

const OUTPUT_READER = textOutputReader({
  "/tmp/tasks/task-2.output": Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"),
  "/tmp/tasks/task-3.output":
    "frame 1840/2400 (76%) fps=58.2 q=23.0 size=   48128kB time=00:01:16.66 bitrate=5143.2kbits/s\n",
});

const TASKS = [
  makeTask(),
  makeCommandTask(),
  makeCommandTask({
    taskId: "task-3",
    toolCallId: "call-3",
    description: "Render the launch video",
    outputFile: "/tmp/tasks/task-3.output",
  }),
];

const APPROVAL: PermissionPrompt = {
  sessionId: "s",
  requester: { taskId: "task-1" },
  toolCall: { toolCallId: "p1", title: "Bash: wc -w Welcome.md" },
  options: [],
};

const meta = {
  title: "Agent Mode/Running Tasks",
  component: RunningTasksIndicator,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { tasks: TASKS, permissions: [], onOpenTask: () => {} },
} satisfies Meta<Props>;
export default meta;

const renderWithOutput = ({
  tasks = TASKS,
  permissions = [],
  defaultOpen,
  onStopTask,
}: Partial<Props>) => (
  <TooltipProvider>
    <TaskOutputReaderContext.Provider value={OUTPUT_READER}>
      <div className="tw-flex tw-h-72 tw-items-end">
        <RunningTasksIndicator
          tasks={tasks}
          permissions={permissions}
          defaultOpen={defaultOpen}
          onOpenTask={() => {}}
          onStopTask={onStopTask}
        />
      </div>
    </TaskOutputReaderContext.Provider>
  </TooltipProvider>
);

export const Count: StoryObj<Props> = { render: renderWithOutput };

export const OneTask: StoryObj<Props> = {
  render: renderWithOutput,
  args: { tasks: [makeTask()] },
};

export const PopoverRows: StoryObj<Props> = {
  render: renderWithOutput,
  args: { defaultOpen: true },
};

export const NeedsApproval: StoryObj<Props> = {
  render: renderWithOutput,
  args: { defaultOpen: true, permissions: [APPROVAL] },
};

export const PopoverRowsWithStop: StoryObj<Props> = {
  render: renderWithOutput,
  args: { defaultOpen: true, onStopTask: () => {} },
};

export const PopoverRowsStarting: StoryObj<Props> = {
  render: renderWithOutput,
  args: {
    defaultOpen: true,
    onStopTask: () => {},
    tasks: [
      makeTask({ taskId: undefined, description: "", subagentType: undefined }),
      makeTask({
        taskId: undefined,
        toolCallId: "call-4",
        description: "Summarize the meeting notes",
      }),
      makeCommandTask(),
    ],
  },
};
