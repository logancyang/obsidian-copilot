import {
  ProjectFolderSection,
  type ProjectFolderSectionProps,
  type ProjectTreeNode,
} from "@/agentMode/ui/ProjectFilesView";
import type { Meta, StoryObj } from "@/lib/story";

const ROOT = "copilot/projects/q4-launch";

function file(path: string): ProjectTreeNode {
  return { kind: "file", path: `${ROOT}/${path}`, name: path.split("/").pop() ?? path };
}

function folder(path: string, children: ProjectTreeNode[] | null = null): ProjectTreeNode {
  return { kind: "folder", path: `${ROOT}/${path}`, name: path.split("/").pop() ?? path, children };
}

const meta = {
  title: "Agent Mode/Project Files View",
  component: ProjectFolderSection,
  args: {
    folderPath: ROOT,
    nodes: [],
    onToggleFolder: () => {},
    onOpenFile: () => {},
    onShowFileMenu: () => {},
    onDragFile: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ProjectFolderSectionProps>;
export default meta;

export const Empty: StoryObj<ProjectFolderSectionProps> = {};

export const Populated: StoryObj<ProjectFolderSectionProps> = {
  args: {
    nodes: [
      folder("outputs", [
        folder("outputs/charts"),
        file("outputs/launch-timeline.md"),
        file("outputs/press-release-v2.md"),
        file("outputs/pricing-comparison.csv"),
      ]),
      folder("sources"),
      file("AGENTS.md"),
      file("brief.md"),
    ],
  },
};

export const DeeplyNested: StoryObj<ProjectFolderSectionProps> = {
  args: {
    folderPath: "Work/Clients/Northwind Traders/copilot/projects/2026 regional expansion research",
    nodes: [
      folder("outputs", [
        folder("outputs/research", [
          folder("outputs/research/competitors", [
            folder("outputs/research/competitors/pricing", [
              folder("outputs/research/competitors/pricing/enterprise tiers", [
                file(
                  "outputs/research/competitors/pricing/enterprise tiers/Comparative analysis of enterprise pricing across regional competitors.md"
                ),
                file("outputs/research/competitors/pricing/enterprise tiers/tiers.csv"),
              ]),
            ]),
            file("outputs/research/competitors/acme.md"),
          ]),
        ]),
        file("outputs/summary.md"),
      ]),
      file("AGENTS.md"),
    ],
  },
};
