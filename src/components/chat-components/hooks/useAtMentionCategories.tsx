import React, { useMemo } from "react";
import { TFile, TFolder } from "obsidian";
import { FileText, Wrench, Folder, Hash } from "lucide-react";
import { TypeaheadOption } from "../TypeaheadMenuContent";

export type AtMentionCategory = "notes" | "tools" | "folders" | "tags";

export interface AtMentionOption extends TypeaheadOption {
  category: AtMentionCategory;
  data: TFile | string | TFolder;
}

export interface CategoryOption extends TypeaheadOption {
  category: AtMentionCategory;
  icon: React.ReactNode;
}

export const CATEGORY_OPTIONS: CategoryOption[] = [
  {
    key: "notes",
    title: "Notes",
    subtitle: "Reference notes in your vault",
    category: "notes",
    icon: <FileText className="tw-size-4" />,
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
    key: "tags",
    title: "Tags",
    subtitle: "Reference existing tags",
    category: "tags",
    icon: <Hash className="tw-size-4" />,
  },
];

/**
 * Hook that provides available @ mention categories based on Copilot Plus status.
 * Returns the array of available category options directly.
 *
 * @param isCopilotPlus - Whether Copilot Plus features are enabled
 * @returns Array of CategoryOption objects
 */
export function useAtMentionCategories(isCopilotPlus: boolean = false): CategoryOption[] {
  // Filter category options based on Copilot Plus status
  return useMemo(() => {
    return CATEGORY_OPTIONS.filter((cat) => {
      if (cat.category === "tools") {
        return isCopilotPlus;
      }
      return true;
    });
  }, [isCopilotPlus]);
}
