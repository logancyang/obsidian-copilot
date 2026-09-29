import React, { useMemo } from "react";
import { TFile, TFolder } from "obsidian";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { FileText, Wrench, Folder, Globe, Image, Bot } from "lucide-react";
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
}

export interface AgentMentionBrand {
  readonly id: string;
  readonly displayName: string;
  readonly Icon: React.ComponentType<{ className?: string }>;
  readonly needsSelfHostWarning?: boolean;
}

export const EMPTY_AGENT_MENTION_BRANDS: ReadonlyArray<AgentMentionBrand> = Object.freeze([]);

export interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
  isAction?: boolean;
}

const AGENTS_CATEGORY: CategoryOption = {
  key: "agents",
  title: "Agents",
  subtitle: "Ask another coding agent this turn",
  category: "agents",
  icon: <Bot className="tw-size-4" />,
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

export function shouldShowAtMentionTools(args: {
  isCopilotPlus: boolean;
  isAgentMode: boolean;
}): boolean {
  return args.isCopilotPlus && !args.isAgentMode;
}

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
