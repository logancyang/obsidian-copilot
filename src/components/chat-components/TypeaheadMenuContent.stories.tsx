import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { FileText, Folder, Hash } from "lucide-react";
import { composeSlashMenuItems } from "./plugins/slashMenuItems";
import { TypeaheadMenuContent, type TypeaheadMenuContentProps } from "./TypeaheadMenuContent";

const agentSlashOptions = composeSlashMenuItems(
  [
    {
      name: "summarize",
      description: "Summarize the active note in five bullets",
      filePath: "/skills/summarize/SKILL.md",
      dirPath: "/skills/summarize",
      body: "Summarize the active note in five bullets.",
      enabledAgents: ["claude"],
      location: { kind: "canonical" },
    },
  ],
  [
    {
      title: "polish",
      content: "Tighten the prose of {activeNote} without changing its meaning.",
      showInContextMenu: false,
      showInSlashMenu: true,
      order: 0,
      modelKey: "",
      lastUsedMs: 0,
    },
  ],
  "claude",
  true
).map((item) => ({
  key: item.key,
  title: item.name,
  subtitle: item.description || undefined,
  content: item.body,
}));

const meta = {
  title: "Chat/Typeahead Menu",
  component: TypeaheadMenuContent,
  parameters: { gallery: { host: "popover", layout: "centered" } },
} satisfies Meta<TypeaheadMenuContentProps>;
export default meta;

export const AgentSlashMenu: StoryObj<TypeaheadMenuContentProps> = {
  args: {
    options: agentSlashOptions,
    selectedIndex: 0,
    onSelect: () => undefined,
    onHighlight: () => undefined,
    showPreview: true,
  },
};

export const AddContextSearch: StoryObj<TypeaheadMenuContentProps> = {
  args: {
    options: [
      { key: "notes", title: "Notes", icon: <FileText className="tw-size-4" /> },
      { key: "folders", title: "Folders", icon: <Folder className="tw-size-4" /> },
      { key: "tags", title: "Tags", icon: <Hash className="tw-size-4" /> },
    ],
    selectedIndex: 0,
    onSelect: () => undefined,
    onHighlight: () => undefined,
    mode: "category",
    searchBarMode: true,
    searchQuery: "",
    onSearchChange: () => undefined,
  },
};
