import { SessionsSidebarPanel } from "@/agentMode/ui/SessionsSidebarPanel";
import {
  inertChatActions,
  sidebarChat,
  sidebarProject,
} from "@/agentMode/ui/testing/sessionsSidebarFixtures";
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
    activeChatIds: none,
    runningChatIds: none,
    waitingChatIds: none,
    attentionChatIds: none,
    openChatIds: none,
    actions: inertChatActions(),
    onNewChat: () => {},
    onOpenChat: () => {},
    onToggleProject: () => {},
    onProjectDeleted: () => {},
    onViewArchived: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<SessionsSidebarPanelProps>;
export default meta;

function WithToggleableFolders(args: Partial<SessionsSidebarPanelProps>) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(args.expandedProjectIds ?? none);
  return (
    <SessionsSidebarPanel
      {...meta.args}
      {...args}
      expandedProjectIds={expanded}
      onToggleProject={(id) =>
        setExpanded((current) => {
          const next = new Set(current);
          if (!next.delete(id)) next.add(id);
          return next;
        })
      }
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
