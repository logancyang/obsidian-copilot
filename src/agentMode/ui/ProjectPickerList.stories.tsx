import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type ProjectPickerListProps = React.ComponentProps<typeof ProjectPickerList>;

const now = Date.now();
const projects: ProjectPickerListProps["projects"] = [
  {
    id: "product-research",
    name: "Product research",
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: now - 86_400_000,
    UsageTimestamps: now - 12 * 60_000,
  },
  {
    id: "writing-workshop",
    name: "Writing workshop",
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: now - 172_800_000,
    UsageTimestamps: now - 95 * 60_000,
  },
  {
    id: "reading-notes",
    name: "Reading notes",
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: now - 259_200_000,
    UsageTimestamps: now - 6 * 60 * 60_000,
  },
];

const ProjectPickerDemo: React.FC = () => {
  const app = useApp();
  return (
    <ProjectPickerList
      app={app}
      projects={projects}
      onSelect={() => undefined}
      onCreate={() => undefined}
    />
  );
};

const meta = {
  title: "Agent Mode/Project Picker List",
  component: ProjectPickerList,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ProjectPickerListProps>;
export default meta;

/** Project identities use the same neutral folder treatment in every row. */
export const Default: StoryObj<ProjectPickerListProps> = {
  render: () => <ProjectPickerDemo />,
};
