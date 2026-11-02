import { SessionsSidebarPanel } from "@/agentMode/navigator/ui/SessionsSidebarPanel";
import {
  inertChatActions,
  sidebarChat,
  sidebarProject,
} from "@/agentMode/navigator/ui/testing/sessionsSidebarFixtures";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef, useState } from "react";

type SessionsSidebarPanelProps = React.ComponentProps<typeof SessionsSidebarPanel>;

const none: ReadonlySet<string> = new Set();

const meta = {
  title: "Agent Mode/Sessions Sidebar",
  component: SessionsSidebarPanel,
  args: {
    items: [],
    projects: [],
    expandedProjectIds: none,
    projectOrder: none,
    activeProjectId: "",
    activeChatIds: none,
    runningChatIds: none,
    waitingChatIds: none,
    attentionChatIds: none,
    openChatIds: none,
    collapsedGroups: none,
    onToggleGroup: () => {},
    actions: inertChatActions({ onCloseSession: async () => {} }),
    onNewChat: () => {},
    onOpenChat: () => {},
    onToggleProject: () => {},
    onReorderProjects: () => {},
    onOpenProject: () => {},
    onCreateProject: async () => {},
    onProjectDeleted: () => {},
    onViewArchived: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<SessionsSidebarPanelProps>;
export default meta;

function toggled(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
}

function WithToggleableFolders(args: Partial<SessionsSidebarPanelProps>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(args.expandedProjectIds ?? none);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(args.collapsedGroups ?? none);
  return (
    <SessionsSidebarPanel
      {...meta.args}
      {...args}
      expandedProjectIds={expanded}
      onToggleProject={(id) => setExpanded((current) => toggled(current, id))}
      collapsedGroups={collapsed}
      onToggleGroup={(id) => setCollapsed((current) => toggled(current, id))}
    />
  );
}

const projects = [
  sidebarProject("garden", "Garden plans"),
  sidebarProject("launch", "Fall product launch"),
  sidebarProject("thesis", "Thesis research with a very long name that must truncate"),
];

const projectChat = (projectId: string, index: number, minutesAgo: number) =>
  sidebarChat(`chats/${projectId}-${index}.md`, `${projectId} chat ${index}`, minutesAgo, {
    projectId,
  });

const everyGroupItems = [
  sidebarChat("chats/pinned.md", "Weekly review template", 600, { pinnedAt: 2 }),
  sidebarChat("chats/pinned-project.md", "Pricing page copy", 90, {
    pinnedAt: 3,
    projectId: "launch",
  }),
  projectChat("garden", 1, 30),
  projectChat("garden", 2, 200),
  projectChat("launch", 1, 15),
  projectChat("thesis", 1, 400),
  sidebarChat("chats/recent-1.md", "Summarize the Q3 interview notes", 5),
  sidebarChat("chats/recent-2.md", "Draft the release announcement", 120),
  sidebarChat(
    "chats/recent-3.md",
    "Investigate why the nightly sync keeps overwriting the reading list after a rename on mobile",
    900
  ),
];

export const Empty: StoryObj<SessionsSidebarPanelProps> = {};

export const EveryGroupPopulated: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: everyGroupItems,
    projects,
    expandedProjectIds: new Set(["garden"]),
    activeChatIds: new Set(["chats/garden-1.md"]),
    openChatIds: new Set([
      "chats/garden-1.md",
      "chats/pinned-project.md",
      "chats/recent-1.md",
      "chats/recent-2.md",
    ]),
    runningChatIds: new Set(["chats/recent-1.md"]),
    waitingChatIds: new Set(["chats/pinned-project.md"]),
    attentionChatIds: new Set(["chats/pinned.md"]),
  },
  render: WithToggleableFolders,
};

export const FoldedGroupAndEmptyProject: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: everyGroupItems,
    projects: [...projects, sidebarProject("empty", "Reading list")],
    expandedProjectIds: new Set(["garden", "empty"]),
    collapsedGroups: new Set(["pinned"]),
  },
  render: WithToggleableFolders,
};

export const CollapsedFolderStatuses: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: [
      projectChat("garden", 1, 30),
      projectChat("launch", 1, 15),
      projectChat("thesis", 1, 400),
      projectChat("quiet", 1, 60),
    ],
    projects: [...projects, sidebarProject("quiet", "No attention needed")],
    waitingChatIds: new Set(["chats/garden-1.md"]),
    attentionChatIds: new Set(["chats/launch-1.md", "chats/garden-1.md"]),
    runningChatIds: new Set(["chats/thesis-1.md"]),
  },
  render: WithToggleableFolders,
};

export const ShowMoreInProjectsAndChats: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: Array.from({ length: 8 }, (_, index) => projectChat("garden", index + 1, index * 20)),
    projects: [
      sidebarProject("garden", "Garden plans"),
      ...Array.from({ length: 6 }, (_, index) =>
        sidebarProject(`extra-${index}`, `Project ${index + 2}`)
      ),
    ],
    expandedProjectIds: new Set(["garden"]),
    waitingChatIds: new Set(["chats/garden-8.md"]),
  },
  render: WithToggleableFolders,
};

export const ManyRecents: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: Array.from({ length: 60 }, (_, index) =>
      sidebarChat(`chats/chat-${index}.md`, `Research thread ${index + 1}`, index * 45)
    ),
    activeChatIds: new Set(["chats/chat-3.md"]),
    runningChatIds: new Set(["chats/chat-1.md"]),
  },
};

function CreateProjectDialogPanel(args: Partial<SessionsSidebarPanelProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>('button[aria-label="New project"]')?.click();
  }, []);
  return (
    <div ref={containerRef} className="tw-size-full">
      <WithToggleableFolders {...args} />
    </div>
  );
}

function FilteredPanel(args: Partial<SessionsSidebarPanelProps> & { query: string }) {
  const { query, ...panelArgs } = args;
  const containerRef = useRef<HTMLDivElement>(null);
  const [searchOpened, setSearchOpened] = useState(false);
  useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>('button[aria-label="Search chats"]')?.click();
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- re-run the query effect once the opened search input has mounted
    setSearchOpened(true);
  }, []);
  useEffect(() => {
    const input = containerRef.current?.querySelector<HTMLInputElement>("input");
    if (!searchOpened || !input) return;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- React ignores a plain `input.value =` assignment
    const { set } = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value") ?? {};
    if (set) Reflect.apply(set, input, [query]);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [query, searchOpened]);
  return (
    <div ref={containerRef} className="tw-size-full">
      <WithToggleableFolders {...panelArgs} />
    </div>
  );
}

export const FilterWithMatches: StoryObj<SessionsSidebarPanelProps> = {
  args: { items: everyGroupItems, projects, query: "chat" } as Partial<SessionsSidebarPanelProps>,
  render: FilteredPanel as React.ComponentType<Partial<SessionsSidebarPanelProps>>,
};

export const FilterWithNoMatches: StoryObj<SessionsSidebarPanelProps> = {
  args: { items: everyGroupItems, projects, query: "zebra" } as Partial<SessionsSidebarPanelProps>,
  render: FilteredPanel as React.ComponentType<Partial<SessionsSidebarPanelProps>>,
};

export const ProjectLandingOpen: StoryObj<SessionsSidebarPanelProps> = {
  args: { items: everyGroupItems, projects, activeProjectId: "garden" },
  render: (args) => <WithToggleableFolders {...args} expandedProjectIds={new Set(["garden"])} />,
};

export const NoProjectsYet: StoryObj<SessionsSidebarPanelProps> = {
  args: { items: [sidebarChat("chats/recent-1.md", "Summarize the Q3 interview notes", 5)] },
};

export const CreateProjectDialogOpen: StoryObj<SessionsSidebarPanelProps> = {
  args: { items: everyGroupItems, projects, expandedProjectIds: new Set(["garden"]) },
  render: CreateProjectDialogPanel,
};

// A story cannot hold a real pointer down, so it starts a pointer drag on the named row and moves it down by the
// given number of rows without releasing it.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/811
function MidDragPanel(
  args: Partial<SessionsSidebarPanelProps> & { dragRow: string; rowsDown: number }
) {
  const { dragRow, rowsDown, ...panelArgs } = args;
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = containerRef.current?.ownerDocument;
    const row = Array.from(containerRef.current?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent === dragRow
    );
    if (!doc || !row) return;
    const { left, top, height } = row.getBoundingClientRect();
    const at = (dy: number) => ({ clientX: left + 40, clientY: top + height / 2 + dy });
    row.dispatchEvent(
      new PointerEvent("pointerdown", { ...at(0), bubbles: true, isPrimary: true, button: 0 })
    );
    doc.dispatchEvent(new PointerEvent("pointermove", { ...at(12), bubbles: true }));
    doc.dispatchEvent(
      new PointerEvent("pointermove", { ...at(rowsDown * (height + 2)), bubbles: true })
    );
    return () => {
      doc.defaultView?.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    };
  }, [dragRow, rowsDown]);
  return (
    <div ref={containerRef} className="tw-size-full">
      <WithToggleableFolders {...panelArgs} />
    </div>
  );
}

const pins = [
  sidebarChat("chats/pin-1.md", "Weekly review template", 600, { pinnedAt: 4 }),
  sidebarChat("chats/pin-2.md", "Pricing page copy", 90, { pinnedAt: 3, projectId: "launch" }),
  sidebarChat("chats/pin-3.md", "Reading list triage", 300, { pinnedAt: 2 }),
  sidebarChat("chats/pin-4.md", "Interview question bank", 45, { pinnedAt: 1 }),
];

export const DraggingPinnedChat: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: [...pins, ...everyGroupItems.slice(2)],
    projects,
    dragRow: "Weekly review template",
    rowsDown: 1.5,
  } as Partial<SessionsSidebarPanelProps>,
  render: MidDragPanel as React.ComponentType<Partial<SessionsSidebarPanelProps>>,
};

export const DraggingExpandedProject: StoryObj<SessionsSidebarPanelProps> = {
  args: {
    items: everyGroupItems,
    projects,
    expandedProjectIds: new Set(["garden"]),
    dragRow: "Garden plans",
    rowsDown: 4,
  } as Partial<SessionsSidebarPanelProps>,
  render: MidDragPanel as React.ComponentType<Partial<SessionsSidebarPanelProps>>,
};
