import type { Meta, StoryObj } from "@/lib/story";
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

export const AgentCompactSearch: StoryObj<TypeaheadMenuContentProps> = {
  args: {
    ...AgentSlashMenu.args,
    options: [
      agentSlashOptions[0],
      {
        key: "command:Compact",
        title: "Compact",
        content: "Run the custom command named Compact.",
      },
    ],
    query: "compact",
  },
};
