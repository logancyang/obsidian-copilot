import {
  LinkedSection,
  type LinkedProjectRow,
  ProjectFolderSection,
  RecentFilesSection,
  type ProjectFolderSectionProps,
  type ProjectTreeNode,
  type RecentProjectFile,
} from "@/agentMode/ui/ProjectFilesView";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const ROOT = "copilot/projects/q4-launch";

function file(path: string): ProjectTreeNode {
  return { kind: "file", path: `${ROOT}/${path}`, name: path.split("/").pop() ?? path };
}

function folder(path: string, children: ProjectTreeNode[] | null = null): ProjectTreeNode {
  return { kind: "folder", path: `${ROOT}/${path}`, name: path.split("/").pop() ?? path, children };
}

const NOW = Date.UTC(2026, 10, 4, 12);
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function recent(
  path: string,
  change: RecentProjectFile["change"],
  ageMs: number
): RecentProjectFile {
  const name = path.split("/").pop() ?? path;
  return {
    path: `${ROOT}/${path}`,
    name,
    folder: path.slice(0, -name.length),
    change,
    mtime: NOW - ageMs,
  };
}

const RECENT_FILES: RecentProjectFile[] = [
  recent("outputs/launch-timeline.md", "new", 12 * MINUTE),
  recent("brief.md", "edited", 2 * 60 * MINUTE),
  recent(
    "outputs/charts/2026/Signup funnel by region and acquisition channel.png",
    "new",
    1.5 * DAY
  ),
  recent("outputs/press-release-v2.md", "edited", 3 * DAY),
  recent("outputs/pricing-comparison.csv", "new", 40 * DAY),
];

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

const POPULATED_NODES: ProjectTreeNode[] = [
  folder("outputs", [
    folder("outputs/charts"),
    file("outputs/launch-timeline.md"),
    file("outputs/press-release-v2.md"),
    file("outputs/pricing-comparison.csv"),
  ]),
  folder("sources"),
  file("AGENTS.md"),
  file("brief.md"),
];

export const Populated: StoryObj<ProjectFolderSectionProps> = {
  args: { nodes: POPULATED_NODES },
};

export const Recent: StoryObj<ProjectFolderSectionProps> = {
  args: { nodes: POPULATED_NODES },
  render: (props) => (
    <>
      <RecentFilesSection
        files={RECENT_FILES}
        now={NOW}
        onOpenFile={() => {}}
        onShowFileMenu={() => {}}
        onDragFile={() => {}}
      />
      <ProjectFolderSection {...(props as ProjectFolderSectionProps)} />
    </>
  ),
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

function linked(
  pattern: string,
  node: ProjectTreeNode,
  parent: string,
  missing = false
): LinkedProjectRow {
  return { pattern, node, parent, missing };
}

const LINKED_ROWS: LinkedProjectRow[] = [
  linked(
    "Meetings/Launch syncs",
    {
      kind: "folder",
      path: "Meetings/Launch syncs",
      name: "Launch syncs",
      children: [
        {
          kind: "file",
          path: "Meetings/Launch syncs/2026-10-14 sync.md",
          name: "2026-10-14 sync.md",
        },
        {
          kind: "file",
          path: "Meetings/Launch syncs/2026-10-21 sync.md",
          name: "2026-10-21 sync.md",
        },
      ],
    },
    "Meetings/"
  ),
  linked(
    "Work/Clients/Northwind Traders/Research/Pricing",
    {
      kind: "folder",
      path: "Work/Clients/Northwind Traders/Research/Pricing",
      name: "Pricing",
      children: null,
    },
    "Work/Clients/Northwind Traders/Research/"
  ),
  linked(
    "Personal/Pricing",
    { kind: "folder", path: "Personal/Pricing", name: "Pricing", children: null },
    "Personal/"
  ),
  linked(
    "[[Personas]]",
    { kind: "file", path: "Research/Personas.md", name: "Personas.md" },
    "Research/"
  ),
  linked(
    "[[Old launch plan]]",
    { kind: "file", path: "[[Old launch plan]]", name: "Old launch plan" },
    "",
    true
  ),
];

function renderWithLinked(rows: LinkedProjectRow[], isDragOver: boolean) {
  function FilesWithLinked(props: ProjectFolderSectionProps): React.ReactElement {
    return (
      <>
        <ProjectFolderSection {...props} />
        <LinkedSection
          rows={rows}
          isDragOver={isDragOver}
          onAdd={() => {}}
          onUnlink={() => {}}
          onToggleFolder={() => {}}
          onOpenFile={() => {}}
          onShowFileMenu={() => {}}
          onDragFile={() => {}}
        />
      </>
    );
  }
  return FilesWithLinked;
}

export const LinkedEmpty: StoryObj<ProjectFolderSectionProps> = {
  args: { nodes: POPULATED_NODES },
  render: renderWithLinked([], false),
};

export const LinkedPopulated: StoryObj<ProjectFolderSectionProps> = {
  args: { nodes: POPULATED_NODES },
  render: renderWithLinked(LINKED_ROWS, false),
};

export const LinkedDragOver: StoryObj<ProjectFolderSectionProps> = {
  args: { nodes: POPULATED_NODES },
  render: renderWithLinked(LINKED_ROWS, true),
};
