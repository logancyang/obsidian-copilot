import {
  FILES_DROP_HIGHLIGHT,
  LinkedSection,
  type LinkedProjectRow,
  type LinkedMatchRow,
  ProjectFolderSection,
  type ProjectFolderSectionProps,
  type ProjectTreeNode,
} from "@/agentMode/ui/ProjectFilesView";
import type { Meta, StoryObj } from "@/lib/story";
import { createUrlItem, type UrlItem } from "@/lib/url-tag";
import { cn } from "@/lib/utils";
import React from "react";

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

function matchedNote(path: string) {
  const name = path.split("/").pop() ?? path;
  return { node: { kind: "file", path, name } as const, parent: path.slice(0, -name.length) };
}

function tag(pattern: string, count: number, notes: string[] | null = null): LinkedMatchRow {
  return { kind: "tag", pattern, label: pattern, count, notes: notes?.map(matchedNote) ?? null };
}

const LINKED_TAGS: LinkedMatchRow[] = [
  tag("#launch", 3, [
    "Meetings/Launch syncs/2026-10-21 sync.md",
    "Plans/Q4 launch brief.md",
    "Work/Clients/Northwind Traders/Research/Regional launch readiness checklist.md",
  ]),
  tag("#research/pricing", 1),
  tag("#archived", 0),
];

const LINKED_PROPERTIES: LinkedMatchRow[] = [
  {
    kind: "property",
    pattern: "[status:active]",
    label: "status: active",
    count: 2,
    notes: ["Plans/Q4 launch brief.md", "Research/Personas.md"].map(matchedNote),
  },
  {
    kind: "property",
    pattern: "[client:Northwind Traders regional expansion program]",
    label: "client: Northwind Traders regional expansion program",
    count: 14,
    notes: null,
  },
  { kind: "property", pattern: "[reviewer:]", label: "reviewer: (any)", count: 0, notes: null },
];

const LINKED_URLS: UrlItem[] = [
  createUrlItem("https://example.com/launch/brief"),
  createUrlItem(
    "https://developer.example.com/docs/pricing/enterprise-tiers-and-regional-discounts?ref=launch-plan"
  ),
  createUrlItem("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
];

function renderWithLinked(
  rows: LinkedProjectRow[],
  isDragOver: boolean,
  matches: LinkedMatchRow[] = [],
  urls: UrlItem[] = []
) {
  function FilesWithLinked(props: ProjectFolderSectionProps): React.ReactElement {
    return (
      <div className={cn("tw-flex tw-flex-col tw-rounded-md", isDragOver && FILES_DROP_HIGHLIGHT)}>
        <ProjectFolderSection {...props} />
        <LinkedSection
          rows={rows}
          matches={matches}
          urls={urls}
          onLink={() => {}}
          onUnlink={() => {}}
          onOpenUrl={() => {}}
          onUnlinkUrl={() => {}}
          onToggleFolder={() => {}}
          onOpenFile={() => {}}
          onShowFileMenu={() => {}}
          onDragFile={() => {}}
        />
      </div>
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

export const LinkedTagsAndLinks: StoryObj<ProjectFolderSectionProps> = {
  args: { nodes: POPULATED_NODES },
  render: renderWithLinked(LINKED_ROWS.slice(0, 2), false, LINKED_TAGS, LINKED_URLS),
};

export const LinkedProperties: StoryObj<ProjectFolderSectionProps> = {
  args: { nodes: POPULATED_NODES },
  render: renderWithLinked(LINKED_ROWS.slice(3, 4), false, LINKED_PROPERTIES),
};
