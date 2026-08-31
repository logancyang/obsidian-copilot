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

const LONG_DESCRIPTION_TEXT = [
  "Use this skill whenever a user asks for a detailed review of a long-form note, including its structure, clarity, voice, argument, transitions, evidence, examples, terminology, headings, opening, conclusion, and fit for the intended audience.",
  "Read the whole note before suggesting changes, preserve the author's meaning, distinguish corrections from optional improvements, explain the most important recommendations first, and avoid rewriting passages that already work.",
  "When the note refers to linked sources, inspect those sources before evaluating factual support, and say when a source is unavailable instead of guessing what it contains.",
  "For every major finding, identify the affected passage, explain the reader-facing problem, and offer one concrete revision that matches the surrounding voice without turning the response into a full rewrite.",
  "Check that headings describe their sections, paragraphs have a clear purpose, examples support the claims around them, terminology stays consistent, and the conclusion resolves the question introduced at the beginning.",
  "If the note contains uncertain facts or unfinished placeholders, separate those verification needs from editorial feedback so the author can address them without confusing factual risk with stylistic preference.",
  "Return a concise summary followed by prioritized findings, concrete revision options, and a short list of passages that are already effective and should remain unchanged.",
].join(" ");
const LONG_DESCRIPTION = `description: ${LONG_DESCRIPTION_TEXT}`;

const meta = {
  title: "Skills/Load issues",
  component: SkillLoadIssues,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SkillLoadIssuesProps>;

export default meta;

export const OneNotLoaded: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES.slice(0, 1), onViewDetails: noop },
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

export const LongDescriptionPreview: StoryObj<SkillLoadIssuesProps> = {
  args: { issues: ISSUES, onViewDetails: noop },
  parameters: { gallery: { host: "modal", layout: "padded" } },
  render: () => (
    <SkillLoadIssuesModalContent
      issues={[
        {
          ...ISSUES[0],
          reason: `Skill \`description\` must be at most 1024 characters (got ${LONG_DESCRIPTION_TEXT.length})`,
          offendingText: LONG_DESCRIPTION,
        },
      ]}
      onClose={noop}
    />
  ),
};
