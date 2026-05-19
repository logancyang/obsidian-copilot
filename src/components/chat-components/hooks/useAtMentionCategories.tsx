import React, { useMemo } from "react";
import { Platform, TFile, TFolder } from "obsidian";
import { FileText, Wrench, Folder, Globe, Image } from "lucide-react";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import type { WebTabContext } from "@/types/message";

export type AtMentionCategory =
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

export interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
  isAction?: boolean;
}

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
 * @returns Array of CategoryOption objects
 */
export function useAtMentionCategories(showTools: boolean = false): CategoryOption[] {
  return useMemo(() => {
    return CATEGORY_OPTIONS.filter((cat) => {
      if (cat.category === "tools") {
        return showTools;
      }
      if (cat.category === "webTabs") {
        return Platform.isDesktopApp;
      }
      return true;
    });
  }, [showTools]);
}
