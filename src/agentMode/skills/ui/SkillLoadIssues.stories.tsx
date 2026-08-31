import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import {
  AllSkillsNotLoaded,
  SkillLoadIssues,
  type SkillLoadIssue,
  type SkillLoadIssuesProps,
} from "./SkillLoadIssues";

const noop = (): void => {};

const ISSUES: readonly SkillLoadIssue[] = [
  {
    name: "daily-note-review",
    location: ".claude/skills/daily-note-review/",
    reason: 'The description contains ": " and must be quoted.',
    suggestion: 'description: "Use this skill for: reviewing daily notes"',
    revealLabel: "Show in folder",
    onOpen: noop,
    onReveal: noop,
  },
  {
    name: "Release Notes",
    location: "copilot/skills/Release Notes/",
    reason: "Use the same lowercase, hyphenated name in the file and folder.",
    suggestion: "name: release-notes\nfolder: release-notes/",
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

export const MixedWithLoadedSkills: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES },
};

export const AllSkillsNeedRepair: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES },
  render: (args) => (
    <div className="tw-space-y-4">
      <SkillLoadIssues issues={args.issues ?? ISSUES} />
      <AllSkillsNotLoaded />
    </div>
  ),
};
