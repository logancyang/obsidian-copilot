import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import { Folder } from "lucide-react";
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

const overflowProjects: ProjectPickerListProps["projects"] = Array.from(
  { length: 14 },
  (_, index) => ({
    id: `project-${index + 1}`,
    name: index === 4 ? "Long-running competitive research" : `Project ${index + 1}`,
    systemPrompt: "",
    projectModelKey: "",
    modelConfigs: {},
    contextSource: {},
    created: now - index * 86_400_000,
    UsageTimestamps: now - index * 60_000,
  })
);

interface ProjectPickerDemoProps {
  projects: ProjectPickerListProps["projects"];
}

const ProjectPickerDemo = ({ projects: demoProjects }: ProjectPickerDemoProps) => {
  const app = useApp();
  const sections: AgentHomeShelfSection[] = [
    {
      id: "projects",
      icon: <Folder className="tw-size-4" />,
      title: "Projects",
      count: demoProjects.length,
      renderBody: () => (
        <ProjectPickerList
          app={app}
          projects={demoProjects}
          onSelect={() => undefined}
          onCreate={() => undefined}
        />
      ),
    },
  ];

  return <AgentHomeShelf sections={sections} />;
};

const meta = {
  title: "Agent Mode/Project Picker List",
  component: ProjectPickerList,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ProjectPickerListProps>;
export default meta;

/** Project identities use the same neutral folder treatment in every row. */
export const Default: StoryObj<ProjectPickerListProps> = {
  render: () => <ProjectPickerDemo projects={projects} />,
};

/** Overflow uses the same bottom-pinned View-all footer as Recent Chats. */
export const Overflow: StoryObj<ProjectPickerListProps> = {
  render: () => <ProjectPickerDemo projects={overflowProjects} />,
};
