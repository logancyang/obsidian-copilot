import React, { useMemo } from "react";
import { TFile, TFolder } from "obsidian";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { FileText, Wrench, Folder, Globe, Image, Users } from "lucide-react";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import type { WebTabContext } from "@/types/message";

export type AtMentionCategory =
  | "agents"
  | "notes"
  | "tools"
  | "folders"
  | "activeNote"
  | "webTabs"
  | "activeWebTab"
  | "images";

export interface AtMentionOption extends TypeaheadOption {
  category: AtMentionCategory;
  data: TFile | string | TFolder | WebTabContext;
  isAction?: boolean;
  /** Emoji the inserted pill wears — set on agent rows, which have no icon component. */
  pillIcon?: string;
}

/**
 * Minimal shape of a mentionable agent. Local to chat-components so the generic
 * composer never imports Agent Mode internals; Agent Mode passes its
 * structurally-compatible custom agents down as props.
 */
export interface AgentMentionEntry {
  /** Folder name — the id a mention resolves to and the pill carries. */
  readonly slug: string;
  readonly name: string;
  /** One-line self-description, shown under the name so the user can choose. */
  readonly description: string;
  /** The agent's emoji; empty when it set none. */
  readonly icon: string;
}

/** Frozen empty agent list — referential stability for the no-agents default. */
export const EMPTY_AGENT_MENTIONS: ReadonlyArray<AgentMentionEntry> = Object.freeze([]);

/**
 * Everything the composer needs to offer the Agents group: who can be mentioned,
 * whether the group is offered at all, and where "Create an agent" leads when
 * the user has none yet.
 *
 * `enabled` is separate from an empty `entries` on purpose: a user with no
 * agents still gets the group and its create row, while a user without the
 * entitlement gets no group at all (`designdocs/CUSTOM_AGENTS.md` §9).
 */
export interface AgentMentionState {
  readonly entries: ReadonlyArray<AgentMentionEntry>;
  readonly enabled: boolean;
  /** Opens Settings → Agents. Absent outside Agent Mode. */
  readonly onCreateAgent?: () => void;
}

/** Frozen "no Agents group" state — the default for every non-Agent-Mode composer. */
export const NO_AGENT_MENTIONS: AgentMentionState = Object.freeze({
  entries: EMPTY_AGENT_MENTIONS,
  enabled: false,
});

export interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
  isAction?: boolean;
}

/** "Agents" typeahead group — surfaced only in Agent Mode for a Plus user, rendered first. */
const AGENTS_CATEGORY: CategoryOption = {
  key: "agents",
  title: "Agents",
  subtitle: "Ask one of your agents this turn",
  category: "agents",
  icon: <Users className="tw-size-4" />,
};

const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    key: "notes",
    title: "Notes",
    subtitle: "Reference notes in your vault",
    category: "notes",
    icon: <FileText className="tw-size-4" />,
  },
  {
    key: "webTabs",
    title: "Web Tabs",
    subtitle: "Reference open browser tabs",
    category: "webTabs",
    icon: <Globe className="tw-size-4" />,
  },
  {
    key: "tools",
    title: "Tools",
    subtitle: "AI tools and commands",
    category: "tools",
    icon: <Wrench className="tw-size-4" />,
  },
  {
    key: "folders",
    title: "Folders",
    subtitle: "Reference vault folders",
    category: "folders",
    icon: <Folder className="tw-size-4" />,
  },
  {
    key: "images",
    title: "Images",
    subtitle: "Attach image files",
    category: "images",
    icon: <Image className="tw-size-4" />,
    isAction: true,
  },
];

/**
 * Pure helper that decides whether the Copilot built-in `@`-tool surfaces
 * (Tools category and tool hits in search) should be visible. Tools require
 * Copilot Plus AND are suppressed entirely in Agent Mode, which routes
 * through its own backend instead of the Copilot tool runner.
 */
export function shouldShowAtMentionTools(args: {
  isCopilotPlus: boolean;
  isAgentMode: boolean;
}): boolean {
  return args.isCopilotPlus && !args.isAgentMode;
}

/**
 * Hook that provides available @ mention categories. Web Tabs is desktop-only
 * (Web Viewer is not supported on mobile).
 *
 * @param showTools - Whether to include the Copilot Tools category. Compute
 *   via {@link shouldShowAtMentionTools} from the caller's higher-level
 *   signals (e.g. Copilot Plus on, Agent Mode off).
 * @param showAgents - Whether to include the Agents category (Agent Mode, for a
 *   user entitled to fan out). Rendered first when present.
 * @returns Array of CategoryOption objects
 */
export function useAtMentionCategories(
  showTools: boolean = false,
  showAgents: boolean = false
): CategoryOption[] {
  return useMemo(() => {
    const base = CATEGORY_OPTIONS.filter((cat) => {
      if (cat.category === "tools") {
        return showTools;
      }
      if (cat.category === "webTabs") {
        return isDesktopRuntime();
      }
      return true;
    });
    return showAgents ? [AGENTS_CATEGORY, ...base] : base;
  }, [showTools, showAgents]);
}
