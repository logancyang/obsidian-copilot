import { MemorySaveLine, type MemorySaveLineProps } from "@/agents/agentMode/ui/MemorySaveLine";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Copilot Teammates/Memory Save Line",
  component: MemorySaveLine,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: {
    agentName: "Coco",
    memoryPath: "copilot/teammates/coco/MEMORY.md",
    rule: "Launch videos lead with user value, not the feature list.",
    onOpen: () => {},
    onOpenInstruction: () => {},
  },
} satisfies Meta<MemorySaveLineProps>;
export default meta;

export const Remembered: StoryObj<MemorySaveLineProps> = {};

export const RememberedOpened: StoryObj<MemorySaveLineProps> = {
  args: { defaultOpen: true },
};

export const ReplacedARule: StoryObj<MemorySaveLineProps> = {
  args: {
    rule: "Write summaries as short paragraphs, no bullet points.",
    replaced: "Summarize as bullet points.",
  },
};

export const ReplacedARuleOpened: StoryObj<MemorySaveLineProps> = {
  args: { ...ReplacedARule.args, defaultOpen: true },
};

export const GoesAgainstTheInstruction: StoryObj<MemorySaveLineProps> = {
  args: {
    rule: "Taxes are Leo's job now. Point tax questions to Leo.",
    contradicts: "File quarterly estimated taxes.",
  },
};

export const GoesAgainstTheInstructionOpened: StoryObj<MemorySaveLineProps> = {
  args: { ...GoesAgainstTheInstruction.args, defaultOpen: true },
};

export const LongRuleAndName: StoryObj<MemorySaveLineProps> = {
  args: {
    agentName: "Coco the Quarterly Planning and Release Notes Assistant",
    memoryPath:
      "copilot/teammates/coco-the-quarterly-planning-and-release-notes-assistant/MEMORY.md",
    rule: "When a reply mentions a GitHub issue or pull request, link it to the issue on GitHub with its full URL, and put the link right after the number so readers in Discord can open it, https://github.com/logancyang/obsidian-copilot/issues/4242.",
    replaced:
      "Mention issues by number only, because the release notes get pasted into the changelog where numbers link on their own.",
    contradicts:
      "Write release notes as plain numbered lists with no links, so they paste cleanly into every channel we post to.",
  },
};

export const LongRuleAndNameOpened: StoryObj<MemorySaveLineProps> = {
  args: { ...LongRuleAndName.args, defaultOpen: true },
};
