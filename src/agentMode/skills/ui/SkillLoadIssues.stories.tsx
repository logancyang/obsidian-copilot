import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import {
  AllSkillsNotLoaded,
  SkillLoadIssues,
  SkillLoadIssuesModalContent,
  type SkillLoadIssue,
  type SkillLoadIssuesProps,
} from "./SkillLoadIssues";

const noop = (): void => {};

const ISSUES: readonly SkillLoadIssue[] = [
  {
    location: ".claude/skills/daily-note-review/SKILL.md",
    reason: 'The description contains ": " and must be quoted.',
    offendingText: "description: Use this skill for: reviewing daily notes",
    revealLabel: "Show in folder",
    onOpen: noop,
    onReveal: noop,
  },
  {
    location: "copilot/skills/Release Notes/SKILL.md",
    reason: "Use the same lowercase, hyphenated name in the file and folder.",
    offendingText: "name: Release Notes",
    revealLabel: "Reveal in vault",
    onOpen: noop,
    onReveal: noop,
  },
];

const meta = {
  title: "Skills/Load issues",
  component: SkillLoadIssues,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SkillLoadIssuesProps>;

export default meta;

export const OneNotLoaded: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES.slice(0, 1), onViewDetails: noop },
};

export const SharedCause: StoryObj<SkillLoadIssuesProps> = {
  args: {
    issues: [ISSUES[0], { ...ISSUES[0], location: ".claude/skills/weekly-review/SKILL.md" }],
    onViewDetails: noop,
  },
};

export const MixedCauses: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES, onViewDetails: noop },
};

export const AllSkillsNeedRepair: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES, onViewDetails: noop },
  render: (args) => (
    <div className="tw-space-y-4">
      <SkillLoadIssues issues={args.issues ?? ISSUES} onViewDetails={noop} />
      <AllSkillsNotLoaded />
    </div>
  ),
};

export const DetailsOverflow: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES, onViewDetails: noop },
  parameters: { gallery: { host: "modal", layout: "padded" } },
  render: () => (
    <SkillLoadIssuesModalContent
      issues={Array.from({ length: 12 }, (_, index) => ({
        ...ISSUES[index % ISSUES.length],
        location: `.claude/skills/repair-${index + 1}/SKILL.md`,
      }))}
      onClose={noop}
    />
  ),
};
