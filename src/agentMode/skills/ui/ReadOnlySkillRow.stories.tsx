import type { Meta, StoryObj } from "@/lib/story";
import type { AgentBrand } from "@/agentMode/session/types";
import { Bot, Code, Terminal } from "lucide-react";
import React from "react";
import type { ReadOnlySkill } from "@/agentMode/skills/types";
import { ReadOnlySkillRow } from "./ReadOnlySkillRow";

type ReadOnlySkillRowProps = React.ComponentProps<typeof ReadOnlySkillRow>;

const agents: AgentBrand[] = [
  { id: "claude", displayName: "Claude", Icon: Bot },
  { id: "codex", displayName: "Codex", Icon: Code },
  { id: "opencode", displayName: "OpenCode", Icon: Terminal },
];

function skill(overrides: Partial<ReadOnlySkill> & { name: string }): ReadOnlySkill {
  return {
    description: "",
    body: "",
    filePath: `/Users/me/.claude/skills/${overrides.name}/SKILL.md`,
    dirPath: `/Users/me/.claude/skills/${overrides.name}`,
    folders: ["/Users/me/.claude/skills"],
    agents: ["claude"],
    scope: "computer",
    ...overrides,
  };
}

const meta = {
  title: "Skills/Agent folder skill row",
  component: ReadOnlySkillRow,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ReadOnlySkillRowProps>;
export default meta;

const args: ReadOnlySkillRowProps = {
  skill: skill({
    name: "release-notes",
    description: "Draft release notes from the merged pull requests since the last tag.",
    agents: ["claude", "opencode"],
  }),
  agents,
  locationLabel: "~/.claude/skills",
  revealLabel: "Show in folder",
  onOpenSkillMd: () => undefined,
  onReveal: () => undefined,
  containerRef: { current: null },
};

export const OnThisComputer: StoryObj<ReadOnlySkillRowProps> = { args };

export const SharedAcrossFolders: StoryObj<ReadOnlySkillRowProps> = {
  args: {
    ...args,
    skill: skill({
      name: "plan-work-with-a-long-descriptive-name",
      description: "Break a large request into reviewable steps before writing any code.",
      agents: ["claude", "codex", "opencode"],
    }),
    locationLabel: "~/.claude/skills, ~/.agents/skills",
  },
};

export const LinkedIntoVault: StoryObj<ReadOnlySkillRowProps> = {
  args: {
    ...args,
    skill: skill({
      name: "fechar-sessao",
      description: "Close the working session and file the notes.",
      scope: "vault",
      agents: ["claude", "opencode"],
    }),
    locationLabel: ".claude/skills",
    revealLabel: "Reveal in vault",
  },
};
