import { useApp } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentMessagePart } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type AgentTrailProps = React.ComponentProps<typeof AgentTrail>;
type ToolCallOverrides = Partial<Extract<AgentMessagePart, { kind: "tool_call" }>>;

function tool(
  id: string,
  vendorToolName: string,
  overrides: ToolCallOverrides = {}
): AgentMessagePart {
  return { kind: "tool_call", id, title: id, status: "completed", vendorToolName, ...overrides };
}

const say = (text: string): AgentMessagePart => ({ kind: "text", text });

const MIYO_QUERY = "back pain standing desk";
const MIYO_ERROR =
  "Miyo search failed. Continue with keyword search and tell the user to open Miyo. Details: net::ERR_CONNECTION_REFUSED";
const miyoResults = (paths: string[]): ToolCallOverrides["output"] => [
  { type: "text", text: JSON.stringify({ results: paths.map((path) => ({ path })) }) },
];
const MIYO_NOTES = miyoResults(["notes/Standing desk setup.md", "notes/Untitled 3.md"]);

const miyoSearch = (overrides: ToolCallOverrides = {}, query = MIYO_QUERY): AgentMessagePart => ({
  kind: "tool_call",
  id: "miyo-run",
  title: "miyo_search",
  status: "completed",
  mcpServer: "obsidian-copilot",
  vendorToolName: "miyo_search",
  input: { query },
  ...overrides,
});

const MIYO_FOLLOW_UP: AgentMessagePart[] = [
  tool("grep-1", "Grep", { input: { pattern: "standing desk|back pain" } }),
  tool("read-1", "Read", { locations: [{ path: "notes/Standing desk setup.md" }] }),
  say("You wrote that a monitor arm and a sit-stand rhythm fixed it. See [[Standing desk setup]]."),
];

const MIYO_SEARCH: AgentMessagePart[] = [miyoSearch({ output: MIYO_NOTES }), ...MIYO_FOLLOW_UP];

const MIYO_LONG_QUERY =
  "what did I decide about the migration plan for the shared calendar service and who owns the rollout checklist";

const MIYO_SEARCH_LONG_QUERY: AgentMessagePart[] = [
  miyoSearch({ output: MIYO_NOTES }, MIYO_LONG_QUERY),
  say("You decided to move the rollout to the platform team. See [[Standing desk setup]]."),
];

const MIYO_LINK_NOTES: Record<string, string> = {
  "Standing desk setup": "notes/Standing desk setup.md",
  "Untitled 3": "notes/Untitled 3.md",
  "Reading list": "notes/Reading list.md",
  "Trip planning": "notes/Trip planning.md",
};

const MIYO_LINKS: AgentMessagePart[] = [
  miyoSearch({ output: MIYO_NOTES }),
  tool("grep-1", "Grep", { input: { pattern: "ZX-4471" } }),
  say(
    "Miyo found [[Standing desk setup]] (see [[Standing desk setup#Fixes]]) and your scratch note, [[Untitled 3|desk scratchpad]]. A keyword search added [[Reading list]] and [Trip planning](notes/Trip%20planning.md)."
  ),
];

const MIYO_SEARCH_RUNNING: AgentMessagePart[] = [miyoSearch({ status: "in_progress" })];

const MIYO_SEARCH_FAILED: AgentMessagePart[] = [
  miyoSearch({ status: "failed", output: [{ type: "text", text: MIYO_ERROR }] }),
  say("Miyo is not running, so I could not search your notes. Open Miyo and ask again."),
];

const MiyoTrailDemo: React.FC<{
  parts: AgentMessagePart[];
  isStreaming?: boolean;
  linkNotes?: Record<string, string>;
}> = ({ parts, isStreaming = false, linkNotes }) => {
  const contextApp = useApp();
  const app = linkNotes
    ? Object.create(contextApp, {
        vault: { value: Object.create(contextApp.vault, { getName: { value: () => "step-2" } }) },
        metadataCache: {
          value: {
            getFirstLinkpathDest: (linkpath: string) => {
              const path = linkNotes[linkpath] ?? linkpath;
              return Object.values(linkNotes).includes(path) ? { path } : null;
            },
          },
        },
      })
    : contextApp;
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={isStreaming}
        turnStartedAtMs={isStreaming ? Date.now() - 138_000 : undefined}
        turnDurationMs={isStreaming ? undefined : 138_000}
        timestamp="2026/08/07 20:31:10"
        app={app}
        turnStopReason={isStreaming ? undefined : "end_turn"}
      />
    </TooltipProvider>
  );
};

const meta = {
  title: "Agent Mode/Agent Trail with Miyo",
  component: AgentTrail,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTrailProps>;
export default meta;

export const MiyoSearch: StoryObj<AgentTrailProps> = {
  render: () => <MiyoTrailDemo parts={MIYO_SEARCH} />,
};

export const MiyoSearchLongQuery: StoryObj<AgentTrailProps> = {
  render: () => <MiyoTrailDemo parts={MIYO_SEARCH_LONG_QUERY} />,
};

export const MiyoLinkBadges: StoryObj<AgentTrailProps> = {
  render: () => <MiyoTrailDemo parts={MIYO_LINKS} linkNotes={MIYO_LINK_NOTES} />,
};

export const MiyoSearchRunning: StoryObj<AgentTrailProps> = {
  render: () => <MiyoTrailDemo parts={MIYO_SEARCH_RUNNING} isStreaming />,
};

export const MiyoSearchFailed: StoryObj<AgentTrailProps> = {
  render: () => <MiyoTrailDemo parts={MIYO_SEARCH_FAILED} />,
};
