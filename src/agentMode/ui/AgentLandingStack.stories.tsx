import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { CopilotBrandIcon } from "@/components/ui/CopilotBrandIcon";
import type { Meta, StoryObj } from "@/lib/story";
import { FileSearch, Folder, MessageSquare, RefreshCw } from "lucide-react";
import React from "react";

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
        <div className="tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-border-b tw-border-solid tw-border-border tw-p-2 tw-text-ui-small">
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

function LandingStackCanvas({ args, shelf = args.shelf }: LandingStackCanvasProps) {
  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2">
      <AgentLandingStack
        hero={args.hero ?? null}
        composer={args.composer ?? null}
        floating={args.floating}
        context={args.context}
        shelf={shelf}
      />
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

/** The ten-row preview exercises the landing's full-height centered composition. */
export const FullPreview: StoryObj<AgentLandingStackProps> = {
  render: (args) => <LandingStackCanvas args={args} />,
};

/** The Relevant Notes tab exercises a content-rich shelf inside the shared body viewport. */
export const RelevantNotesPreview: StoryObj<AgentLandingStackProps> = {
  render: (args) => <RelevantNotesPreviewCanvas args={args} />,
};
