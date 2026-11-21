import { AgentFacePicker } from "@/agents/ui/AgentFacePicker";
import {
  AgentProfileView,
  type AgentProfileFacts,
  type AgentProfileViewProps,
} from "@/agents/ui/AgentProfileView";
import type { AgentModelChoices } from "@/agents/ui/CreateAgentForm";
import {
  COCO,
  FIVE_AGENTS,
  KAI,
  LONG_NAMED_AGENT,
  TWELVE_AGENTS,
} from "@/agents/ui/testing/rosterFixtures";
import type { PresetFacesState } from "@/agents/ui/usePresetFaces";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";

const NOW = new Date(2026, 10, 16, 15, 20).getTime();

const COCO_INSTRUCTION =
  "You keep the whole vault in view. Launch plans live in Launch/, release notes in copilot/releases/. Answer briefly and link the notes you used.";

const COCO_FACTS: AgentProfileFacts = {
  chatCount: 23,
  createdAt: new Date(2026, 9, 3, 9, 0).getTime(),
  editedAt: new Date(2026, 10, 2, 17, 45).getTime(),
  memory: { rules: 9, changedAt: new Date(2026, 10, 16, 14, 31).getTime() },
};

const claude = { provider: "agent", enabled: true, _group: "Claude", _backendId: "claude" };
const codex = { provider: "agent", enabled: true, _group: "Codex", _backendId: "codex" };
const effort = ["low", "medium", "high", "max"].map((value) => ({ label: value, value }));

const MODELS: AgentModelChoices = {
  models: [
    { ...claude, name: "opus", displayName: "Opus 5.5" },
    { ...claude, name: "sonnet", displayName: "Sonnet 5.5" },
    { ...claude, name: "haiku", displayName: "Haiku 5.5" },
    { ...codex, name: "gpt-5.5", displayName: "GPT-5.5" },
  ],
  effortOptionsByModelKey: {
    "claude:opus|agent": effort,
    "claude:sonnet|agent": effort,
    "codex:gpt-5.5|agent": effort,
  },
  initial: { baseModelId: "opus", effort: "high" },
};

const PRESET_FACES: PresetFacesState = {
  status: "ready",
  faces: TWELVE_AGENTS.map((agent) => ({
    id: agent.slug,
    alt: `${agent.name}'s face`,
    bytes: new ArrayBuffer(0),
    src: agent.faceSrc,
  })),
  usedIds: new Set(FIVE_AGENTS.map((agent) => agent.slug)),
};

function paths(slug: string) {
  return {
    instructionsPath: `copilot/teammates/${slug}/instructions.md`,
    memoryPath: `copilot/teammates/${slug}/MEMORY.md`,
  };
}

type StoryProps = AgentProfileViewProps & { setup?: (page: HTMLElement) => void };

function SidebarPage({ setup, ...props }: StoryProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) setup?.(ref.current);
  }, [setup]);
  return (
    <TooltipProvider>
      <div ref={ref} className="tw-h-[640px]">
        <AgentProfileView {...props} />
      </div>
    </TooltipProvider>
  );
}

function click(label: string) {
  return (page: HTMLElement) =>
    page.querySelector<HTMLElement>(`[aria-label="${label}"], [title="${label}"]`)?.click();
}

const meta = {
  title: "Copilot Teammates/Agent Profile",
  component: SidebarPage,
  args: {
    agent: {
      ...COCO,
      instruction: COCO_INSTRUCTION,
      model: { baseModelId: "opus", effort: "high" },
      ...paths("coco"),
    },
    facts: COCO_FACTS,
    now: NOW,
    otherAgents: FIVE_AGENTS,
    models: MODELS,
    renderFacePicker: (onPick) => (
      <AgentFacePicker presets={PRESET_FACES} selectedPresetId="coco" onPick={onPick} />
    ),
    onBack: () => {},
    onNewChat: () => {},
    onOpenFile: () => {},
    onRename: async () => {},
    onRetitle: async () => {},
    onChangeFace: () => {},
    onChangeModel: () => {},
    onDelete: () => {},
  },
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<StoryProps>;
export default meta;

export const FullProfile: StoryObj<StoryProps> = {};

export const NewAgentWithNoMemory: StoryObj<StoryProps> = {
  args: {
    agent: {
      ...KAI,
      instruction:
        "You write launch posts and the newsletter. Lead with what the user can now do. Plain words, short sentences.",
      model: { baseModelId: "sonnet", effort: "medium" },
      ...paths("kai"),
    },
    facts: { chatCount: 1, createdAt: NOW - 3_600_000, editedAt: NOW - 3_600_000, memory: null },
  },
};

export const EditIconOnKeyboardFocus: StoryObj<StoryProps> = {
  args: {
    setup: (page) =>
      page
        .querySelector<HTMLElement>('[aria-label="Rename Coco"]')
        ?.focus({ focusVisible: true } as FocusOptions),
  },
};

export const Renaming: StoryObj<StoryProps> = {
  args: { setup: click("Rename Coco") },
};

export const EditingTitle: StoryObj<StoryProps> = {
  args: { setup: click("Change Coco's title") },
};

export const ChangingFace: StoryObj<StoryProps> = {
  args: { setup: click("Change Coco's face") },
};

export const ChangingModel: StoryObj<StoryProps> = {
  args: { setup: click("Model · effort") },
};

export const LongNameAndTitle: StoryObj<StoryProps> = {
  args: {
    agent: {
      ...LONG_NAMED_AGENT,
      name: "Nora · Family & School Logistics Coordinator for the Whole Household",
      instruction: "You run the family calendar.",
      model: null,
      ...paths("nora-family-school"),
    },
    facts: {
      chatCount: 4,
      createdAt: new Date(2026, 8, 21).getTime(),
      editedAt: new Date(2026, 8, 21).getTime(),
      memory: null,
    },
  },
};

export const InstructionPastFourThousand: StoryObj<StoryProps> = {
  args: {
    agent: {
      ...COCO,
      instruction: `${COCO_INSTRUCTION} `.repeat(32).slice(0, 4620),
      model: { baseModelId: "opus", effort: "high" },
      ...paths("coco"),
    },
    facts: {
      ...COCO_FACTS,
      memory: { rules: 31, changedAt: new Date(2026, 10, 12, 9, 0).getTime() },
    },
  },
};

export const LockedWithoutValidLicense: StoryObj<StoryProps> = {
  args: {
    locked: { onUnlock: () => {} },
  },
};

export const NeedsSetupCodingAgentMissing: StoryObj<StoryProps> = {
  args: {
    agent: {
      ...COCO,
      instruction: COCO_INSTRUCTION,
      model: { baseModelId: "opencode/big-pickle", effort: null },
      ...paths("coco"),
    },
    setupLocked: {
      reason: "Coco runs on OpenCode, which isn't set up on this device.",
      setUp: { label: "Set up OpenCode", open: () => {} },
    },
  },
};

export const NeedsSetupModelGone: StoryObj<StoryProps> = {
  args: {
    agent: {
      ...COCO,
      instruction: COCO_INSTRUCTION,
      model: { baseModelId: "gpt-6", effort: null },
      ...paths("coco"),
    },
    setupLocked: { reason: "Coco's model, gpt-6, isn't available on this device." },
  },
};
