import type { TurnFileChange } from "@/agentMode/session/types";
import {
  LinkedSection,
  ProjectFilesPanel,
  type LinkedProjectRow,
  ProjectFolderSection,
  type ProjectTreeNode,
} from "@/projects/ui/ProjectFilesView";
import { ProjectInfoPanel, type ProjectInfoPanelProps } from "@/projects/ui/ProjectInfoPopover";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const ROOT = "copilot/projects/Q4 Launch";

function file(path: string): ProjectTreeNode {
  return { kind: "file", path: `${ROOT}/${path}`, name: path.split("/").pop() ?? path };
}

function folder(path: string, children: ProjectTreeNode[] | null = null): ProjectTreeNode {
  return { kind: "folder", path: `${ROOT}/${path}`, name: path.split("/").pop() ?? path, children };
}

function change(
  path: string,
  status: TurnFileChange["status"],
  additions: number,
  deletions: number
): TurnFileChange {
  return { path, status, before: null, after: null, additions, deletions };
}

const CHAT_CHANGES: TurnFileChange[] = [
  change(`${ROOT}/outputs/launch-timeline.md`, "created", 84, 0),
  change(`${ROOT}/brief.md`, "modified", 3, 1),
  change(
    "Work/Clients/Northwind Traders/Research/Comparative analysis of enterprise pricing across regional competitors.md",
    "modified",
    0,
    9
  ),
];

const SHORT_TREE: ProjectTreeNode[] = [
  folder("outputs"),
  folder("sources"),
  file("AGENTS.md"),
  file("brief.md"),
];

const LONG_TREE: ProjectTreeNode[] = [
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
        file("outputs/research/competitors/globex.md"),
      ]),
      folder("outputs/research/interviews"),
    ]),
    folder("outputs/charts"),
    ...Array.from({ length: 14 }, (_, i) =>
      file(`outputs/weekly-update-2026-${String(i + 1).padStart(2, "0")}.md`)
    ),
    file("outputs/launch-timeline.md"),
  ]),
  folder("sources"),
  file("AGENTS.md"),
  file("brief.md"),
];

const LINKED_ROWS: LinkedProjectRow[] = [
  {
    pattern: "[[Personas]]",
    node: { kind: "file", path: "Research/Personas.md", name: "Personas.md" },
    parent: "Research/",
    missing: false,
  },
];

const noop = (): void => {};

function FilesView({ nodes }: { nodes: ProjectTreeNode[] }): React.ReactElement {
  const handlers = { onOpenFile: noop, onShowFileMenu: noop, onDragFile: noop };
  return (
    <ProjectFilesPanel onLink={noop}>
      <ProjectFolderSection folderPath={ROOT} nodes={nodes} onToggleFolder={noop} {...handlers} />
      <LinkedSection
        rows={LINKED_ROWS}
        matches={[]}
        urls={[]}
        onUnlink={noop}
        onOpenUrl={noop}
        onUnlinkUrl={noop}
        onToggleFolder={noop}
        {...handlers}
      />
    </ProjectFilesPanel>
  );
}

const meta = {
  title: "Agent Mode/Project Info Popover",
  component: ProjectInfoPanel,
  args: {
    changes: [],
    onOpenFile: noop,
    children: <FilesView nodes={SHORT_TREE} />,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ProjectInfoPanelProps>;
export default meta;

export const NoChanges: StoryObj<ProjectInfoPanelProps> = {};

export const Changes: StoryObj<ProjectInfoPanelProps> = {
  args: { changes: CHAT_CHANGES },
};

export const LongTree: StoryObj<ProjectInfoPanelProps> = {
  args: { changes: CHAT_CHANGES, children: <FilesView nodes={LONG_TREE} /> },
};
