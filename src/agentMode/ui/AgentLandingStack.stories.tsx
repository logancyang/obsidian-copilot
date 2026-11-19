import type { CustomAgent } from "@/agents/CustomAgentStore";
import { AgentRoster, NewAgentButton } from "@/agents/ui/AgentRoster";
import { FirstAgentBannerView } from "@/agents/ui/FirstAgentBanner";
import { FIVE_AGENTS, RECENT_CHATS } from "@/agents/ui/testing/rosterFixtures";
import { useAgentRecentChats } from "@/agents/ui/useAgentRecentChats";
import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import { AgentProjectHeader } from "@/projects/ui/AgentProjectHeader";
import { FileSearch, Files, Folder, MessageSquare, RefreshCw } from "lucide-react";
import React, { useState } from "react";

type AgentLandingStackProps = React.ComponentProps<typeof AgentLandingStack>;

interface LandingStackCanvasProps {
  args: Partial<AgentLandingStackProps>;
  shelf?: React.ReactNode;
}

const rows = Array.from({ length: 10 }, (_, index) => `Recent chat ${index + 1}`);
const sections: AgentHomeShelfSection[] = [
  {
    id: "chats",
    icon: <MessageSquare className="tw-size-4" />,
    title: "Recent Chats",
    renderBody: () => (
      <div className="tw-flex tw-flex-col">
        <div className="tw-p-1">
          <div className="tw-h-7 tw-rounded-md tw-border tw-border-solid tw-border-border tw-px-2 tw-text-ui-small tw-leading-7 tw-text-normal">
            Search chats...
          </div>
        </div>
        <div className="tw-flex tw-flex-col tw-divide-y tw-divide-border">
          {rows.map((row) => (
            <div key={row} className="tw-min-h-9 tw-px-2 tw-py-1.5 tw-text-ui-small">
              {row}
            </div>
          ))}
        </div>
      </div>
    ),
  },
];

const relevantNotes = [
  ["Bay Area Events This Week", "26%"],
  ["2026 Inspiration", "23%"],
  ["Summer Travel Ideas", "21%"],
  ["Restaurants to Try", "18%"],
  ["Weekend Reading List", "16%"],
  ["Places to Revisit", "14%"],
] as const;

const relevantNotesSections: AgentHomeShelfSection[] = [
  {
    id: "relevant-notes",
    icon: <FileSearch className="tw-size-4" />,
    title: "Relevant Notes",
    renderBody: () => (
      <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
        <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-2 tw-py-1.5 tw-text-ui-smaller tw-text-muted">
          <span className="tw-min-w-0 tw-flex-1">
            Open Relevant Notes in its own pane to keep it while you chat.
          </span>
          <span className="tw-shrink-0 tw-text-normal">Open pane</span>
        </div>
        <div className="tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-border-0 tw-border-b tw-border-solid tw-border-border tw-p-2 tw-text-ui-small">
          <span className="tw-text-normal">
            Relevant to <span className="tw-font-medium tw-text-normal">Weekend Food Trip</span>
          </span>
          <span className="tw-flex tw-items-center tw-gap-1 tw-rounded-md tw-bg-secondary tw-px-2 tw-py-1 tw-font-medium tw-text-normal">
            <RefreshCw className="tw-size-3.5" />
            Build index
          </span>
        </div>
        <div className="tw-relative tw-min-h-0 tw-flex-1">
          <div className="tw-absolute tw-inset-0 tw-overflow-y-auto tw-p-2">
            <div className="tw-flex tw-flex-col tw-gap-0.5">
              {relevantNotes.map(([title, score]) => (
                <div key={title} className="tw-flex tw-flex-col tw-gap-2 tw-rounded-md tw-p-2">
                  <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-small">
                    <span className="tw-min-w-0 tw-truncate tw-font-medium tw-text-normal">
                      {title}
                    </span>
                    <span className="tw-shrink-0 tw-text-normal">{score}</span>
                  </div>
                  <div className="tw-h-1 tw-rounded-full tw-bg-secondary">
                    <div className="tw-h-full tw-w-1/4 tw-rounded-full tw-bg-interactive-accent" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
  },
];

const projectSections: AgentHomeShelfSection[] = [
  {
    id: "projects",
    icon: <Folder className="tw-size-4" />,
    title: "Projects",
    count: 4,
    renderBody: () => null,
  },
];

const allSections = [...sections, ...relevantNotesSections, ...projectSections];

const projectFilesBody = (
  <div className="tw-p-3 tw-text-ui-small tw-text-normal">
    Project folder: outputs, sources, AGENTS.md
  </div>
);

const projectLandingSections: AgentHomeShelfSection[] = [
  {
    id: "project-files",
    icon: <Files className="tw-size-4" />,
    title: "Files",
    renderBody: () => projectFilesBody,
  },
  { ...sections[0], id: "project-chats", title: "Recent chats" },
];

function LandingStackCanvas({ args, shelf = args.shelf }: LandingStackCanvasProps) {
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2">
      <AgentLandingStack hero={args.hero ?? null} composer={args.composer ?? null} shelf={shelf} />
    </div>
  );
}

function RelevantNotesPreviewCanvas({ args }: Pick<LandingStackCanvasProps, "args">) {
  const [activeSectionId, setActiveSectionId] = React.useState("relevant-notes");

  return (
    <LandingStackCanvas
      args={args}
      shelf={
        <AgentHomeShelf
          sections={allSections}
          activeSectionId={activeSectionId}
          onSectionSelect={setActiveSectionId}
        />
      }
    />
  );
}

function LandingCanvas({
  args,
  project,
  relevantNotesInSidePanel = false,
}: Pick<LandingStackCanvasProps, "args"> & {
  project: boolean;
  relevantNotesInSidePanel?: boolean;
}) {
  const globalSections = relevantNotesInSidePanel
    ? allSections.filter((section) => section.id !== "relevant-notes")
    : allSections;
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2">
      <AgentLandingStack
        hero={args.hero ?? null}
        composer={args.composer ?? null}
        shelf={<AgentHomeShelf sections={project ? projectLandingSections : globalSections} />}
      />
    </div>
  );
}

const meta = {
  title: "Agent Mode/Agent Landing Stack",
  component: AgentLandingStack,
  args: {
    hero: (
      <div className="tw-flex tw-items-center tw-justify-center tw-gap-3">
        <CopilotBrandIcon className="tw-size-6 tw-text-normal" />
        <span className="tw-text-3xl tw-font-[330] tw-text-normal">Where should we start?</span>
      </div>
    ),
    composer: (
      <div className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-4 tw-text-ui-small tw-text-normal">
        Ask Copilot...
      </div>
    ),
    shelf: <AgentHomeShelf sections={sections} />,
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<AgentLandingStackProps>;
export default meta;

export const FullPreview: StoryObj<AgentLandingStackProps> = {
  render: (args) => <LandingStackCanvas args={args} />,
};

export const RelevantNotesPreview: StoryObj<AgentLandingStackProps> = {
  render: (args) => <RelevantNotesPreviewCanvas args={args} />,
};

export const GlobalLanding: StoryObj<AgentLandingStackProps> = {
  render: (args) => <LandingCanvas args={args} project={false} />,
};

export const GlobalLandingRelevantNotesInSidePanel: StoryObj<AgentLandingStackProps> = {
  render: (args) => <LandingCanvas args={args} project={false} relevantNotesInSidePanel />,
};

export const ProjectLanding: StoryObj<AgentLandingStackProps> = {
  render: (args) => <LandingCanvas args={args} project />,
};

export const WithoutShelf: StoryObj<AgentLandingStackProps> = {
  render: (args) => <LandingStackCanvas args={args} shelf={null} />,
};

const noop = async () => {};

function AgentHomeCanvas({
  agents,
  initialSlug,
  project = false,
  customAgentsAvailable = true,
}: {
  agents: readonly CustomAgent[];
  initialSlug: string | null;
  project?: boolean;
  customAgentsAvailable?: boolean;
}) {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState(initialSlug);
  const selected = agents.find((agent) => agent.slug === selectedSlug) ?? null;
  const recentChats = useAgentRecentChats(RECENT_CHATS, agents, selected);
  const chatsSection: AgentHomeShelfSection = {
    id: project ? "project-chats" : "chats",
    icon: <MessageSquare className="tw-size-4" />,
    title: "Recent chats",
    renderBody: () => (
      <GlobalRecentChatsSection
        {...recentChats}
        variant={project ? "project" : "global"}
        onLoadChat={noop}
        onUpdateTitle={noop}
        onDeleteChat={noop}
        onOpenSourceFile={noop}
        onCopyChatLink={noop}
        onSetChatPinned={noop}
        onSetChatArchived={noop}
        onDeleteChats={noop}
        onArchiveChats={noop}
        getChatBookmarkState={async () => "not-bookmarked"}
        onSetChatBookmarked={noop}
      />
    ),
  };
  return (
    <TooltipProvider>
      <div className="tw-flex tw-size-full tw-flex-col">
        {project && (
          <AgentProjectHeader
            projectName="4.0.21 launch video"
            onOpenHome={() => {}}
            onExit={() => {}}
            isProjectHome
          />
        )}
        <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-overflow-y-auto tw-px-2">
          <AgentLandingStack
            hero={
              <AgentRoster
                agents={agents}
                selectedSlug={selected?.slug ?? null}
                onSelect={setSelectedSlug}
                emptyHero={
                  <div className="tw-text-center tw-text-3xl tw-font-[330] tw-text-normal">
                    What are you working on?
                  </div>
                }
                newAgentButton={
                  customAgentsAvailable && (
                    <NewAgentButton emphasized={agents.length === 0} onClick={() => {}} />
                  )
                }
              />
            }
            composer={
              <>
                <div className="tw-flex tw-min-h-28 tw-flex-col tw-justify-between tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-primary tw-p-3 tw-text-ui-small tw-text-muted">
                  <div className="tw-truncate">
                    {selected
                      ? `Ask ${selected.name} anything • @ to add context • / for commands`
                      : "Ask anything • @ to add context • / for commands"}
                  </div>
                  <div className="tw-truncate">Default (recommended) · high</div>
                </div>
                {customAgentsAvailable && agents.length === 0 && !project && !bannerDismissed && (
                  <FirstAgentBannerView
                    faces={FIVE_AGENTS.slice(0, 3).map((agent) => agent.faceSrc)}
                    onCreate={() => {}}
                    onDismiss={() => setBannerDismissed(true)}
                  />
                )}
              </>
            }
            shelf={
              <AgentHomeShelf
                sections={
                  project
                    ? [projectLandingSections[0], chatsSection]
                    : [chatsSection, ...relevantNotesSections, ...projectSections]
                }
                activeSectionId={chatsSection.id}
              />
            }
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

export const AgentHomeAgentSelected: StoryObj<AgentLandingStackProps> = {
  render: () => <AgentHomeCanvas agents={FIVE_AGENTS} initialSlug="coco" />,
};

export const AgentHomeCopilotSelected: StoryObj<AgentLandingStackProps> = {
  render: () => <AgentHomeCanvas agents={FIVE_AGENTS} initialSlug={null} />,
};

export const AgentHomeAgentWithoutChats: StoryObj<AgentLandingStackProps> = {
  render: () => <AgentHomeCanvas agents={FIVE_AGENTS} initialSlug="kai" />,
};

export const AgentHomeFirstAgentBanner: StoryObj<AgentLandingStackProps> = {
  render: () => <AgentHomeCanvas agents={[]} initialSlug={null} />,
};

export const AgentHomeWithoutCopilotTeammates: StoryObj<AgentLandingStackProps> = {
  render: () => <AgentHomeCanvas agents={[]} initialSlug={null} customAgentsAvailable={false} />,
};

export const ProjectHomeAgentSelected: StoryObj<AgentLandingStackProps> = {
  render: () => <AgentHomeCanvas agents={FIVE_AGENTS} initialSlug="maya" project />,
};
