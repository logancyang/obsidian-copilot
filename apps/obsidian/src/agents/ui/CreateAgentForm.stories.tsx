import { FIRST_AGENT_TEMPLATE } from "@/agents/ui/firstAgentTemplate";
import {
  CreateAgentCloseGuard,
  CreateAgentForm,
  type AgentModelChoices,
  type CreateAgentFormProps,
} from "@/agents/ui/CreateAgentForm";
import {
  COCO,
  LEO,
  MAYA,
  NORA,
  THREE_AGENTS,
  TWELVE_AGENTS,
} from "@/agents/ui/testing/rosterFixtures";
import type { PresetFacesState } from "@/agents/ui/usePresetFaces";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";

const claude = { provider: "agent", enabled: true, _group: "Claude", _backendId: "claude" };
const codex = { provider: "agent", enabled: true, _group: "Codex", _backendId: "codex" };
const effort = ["low", "medium", "high", "max"].map((value) => ({ label: value, value }));

const MODELS: AgentModelChoices = {
  models: [
    { ...claude, name: "opus", displayName: "Opus 5.5" },
    { ...claude, name: "sonnet", displayName: "Sonnet 5.5" },
    { ...claude, name: "haiku", displayName: "Haiku 5.5" },
    { ...codex, name: "gpt-5.5", displayName: "GPT-5.5" },
    { ...codex, name: "gpt-5.5-mini", displayName: "GPT-5.5 mini" },
  ],
  effortOptionsByModelKey: {
    "claude:opus|agent": effort,
    "claude:sonnet|agent": effort,
    "codex:gpt-5.5|agent": effort,
  },
  initial: { baseModelId: "opus", effort: "high" },
};

const TEAM = [COCO, MAYA, LEO, NORA];

const PRESET_FACES: PresetFacesState = {
  status: "ready",
  faces: [...TWELVE_AGENTS.slice(4), ...TEAM].map((agent) => ({
    id: agent.slug,
    alt: `${agent.name}'s face`,
    bytes: new ArrayBuffer(0),
    src: agent.faceSrc,
  })),
  usedIds: new Set(TEAM.map((agent) => agent.slug)),
};

const KAI_INSTRUCTION =
  'You handle marketing for Obsidian Copilot: release posts, the newsletter, launch videos and Discord announcements. Release notes are in copilot/releases/ and past newsletters in marketing/newsletter/. Lead with what the user can now do, not the feature list. Plain words, short sentences, no hype words like "supercharge". Give me one draft, not three options.';

const KAI = {
  name: "Kai",
  title: "Writes launch posts and the newsletter",
  instruction: KAI_INSTRUCTION,
};

const UPLOADED_FACE_WEBP_HEX =
  "52494646b00100005745425056503820a4010000300b009d012a400040003e6d2c9345a422a1980c05804006c4b10067abc87d27f20398877c7728db01cf75a601bcd06d01a40999b77317b32ddcc8b46a360eb8bb4aae70668a4974794570a989d3c8101fd5b3eac63d1f9d65c2685f0d4daa68080000fef50e5fff9d82ad5dc73ffaa5d3736007d75345fb2a8d3346cfbc722521e6aecccd46828272ecb1dd3f1ac8c277644c24cd79853e9cb551ddd4178ae2d2c5dc212814fcd33539dd5d2f4cc397298896ea490e8c18b33196b6a0698dc5535e920d7a9e5da34778a842e17381bc9e37f48f8d940a54c96895fe9aa218bee0cf30447a93f771b2c9cd5457875cd2f0adaf27a9837135c10df5fb958943fadd17ee118db389f46b63d60614d7f021591a10f1fefc1266937ad47c669631d68917cfa80708e769f79f0410b2971cb415706a95ab86578631e7c3a3eb18b9a04175295c65437e84f78ded55cd7e21c405739fe82b1f45e1dd8d29f22532f93aa52381dacdf605208bbfe96c69c1e80d6bb57f19d44985a7c89901e60e88c88ca1a1a4d6c0e99f30b3b6024a9750979cc8071b119adaf90ad117ff5489b8f436e0000000";

type StoryProps = Partial<CreateAgentFormProps> & { setup?: (form: HTMLElement) => void };

function FormStory({ setup, ...props }: StoryProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) setup?.(ref.current);
  }, [setup]);
  return (
    <TooltipProvider>
      <div ref={ref}>
        <CreateAgentForm
          agents={TEAM}
          folderNames={(props.agents ?? TEAM).map((agent) => agent.slug)}
          agentsFolder="copilot/teammates"
          models={MODELS}
          presetFaces={PRESET_FACES}
          closeGuard={new CreateAgentCloseGuard()}
          onCreate={async () => {}}
          onClose={() => {}}
          {...props}
        />
      </div>
    </TooltipProvider>
  );
}

function typeNameWithoutLeaving(form: HTMLElement) {
  const name = form.querySelector<HTMLInputElement>('input[placeholder="e.g. Leo"]');
  if (!name) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(name, "Kai");
  name.dispatchEvent(new Event("input", { bubbles: true }));
}

function leaveInstructionEmpty(form: HTMLElement) {
  const instruction = form.querySelector("textarea");
  instruction?.focus();
  instruction?.blur();
}

function openFacePicker(form: HTMLElement) {
  form.querySelector<HTMLButtonElement>('button[aria-label="Change face"]')?.click();
}

function uploadFace(form: HTMLElement) {
  const choose = (input: HTMLInputElement) => {
    const files = new DataTransfer();
    const bytes = Uint8Array.from(UPLOADED_FACE_WEBP_HEX.match(/../g) ?? [], (byte) =>
      parseInt(byte, 16)
    );
    files.items.add(new File([bytes], "photo.webp", { type: "image/webp" }));
    input.files = files.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const observer = new MutationObserver(() => {
    const input = form.ownerDocument.querySelector<HTMLInputElement>("input[type=file]");
    if (!input) return;
    observer.disconnect();
    choose(input);
  });
  observer.observe(form, { childList: true, subtree: true });
  openFacePicker(form);
}

const meta = {
  title: "Copilot Teammates/Create Agent Dialog",
  component: CreateAgentForm,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CreateAgentFormProps>;
export default meta;

export const Empty: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory onAskCopilot={() => {}} />,
};

export const NameTypedNotYetLeft: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory setup={typeNameWithoutLeaving} />,
};

export const FirstAgent: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      agents={[]}
      initialValues={FIRST_AGENT_TEMPLATE}
      presetFaces={{ ...PRESET_FACES, usedIds: new Set() }}
      onAskCopilot={() => {}}
    />
  ),
};

export const Filled: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      initialValues={KAI}
      models={{ ...MODELS, initial: { baseModelId: "sonnet", effort: "medium" } }}
    />
  ),
};

export const FaceGridLoaded: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory initialValues={{ name: "Kai" }} setup={openFacePicker} />,
};

export const FaceGridLoading: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      initialValues={{ name: "Kai" }}
      presetFaces={{ status: "loading" }}
      setup={openFacePicker}
    />
  ),
};

export const FaceGridFailedToLoad: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      initialValues={{ name: "Kai" }}
      presetFaces={{ status: "failed" }}
      setup={openFacePicker}
    />
  ),
};

export const UploadChosen: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory initialValues={KAI} setup={uploadFace} />,
};

export const MissingInstruction: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory initialValues={{ ...KAI, instruction: "" }} setup={leaveInstructionEmpty} />
  ),
};

export const NameAlreadyOnTheTeam: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory initialValues={{ name: "leo", instruction: KAI_INSTRUCTION }} />,
};

export const FolderUsedByRenamedAgent: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      agents={[{ ...COCO, name: "Chief" }, MAYA, LEO, NORA]}
      initialValues={{ name: "Coco", instruction: KAI_INSTRUCTION }}
    />
  ),
};

export const FolderWithoutAgent: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      folderNames={["coco", "maya", "leo", "nora", "kai"]}
      initialValues={{ name: "Kai", instruction: KAI_INSTRUCTION }}
    />
  ),
};

export const LongName: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory initialValues={{ ...KAI, name: "Kai · Launch & Newsletter Writer" }} />,
};

export const InstructionPastFourThousand: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      initialValues={{ ...KAI, instruction: `${KAI_INSTRUCTION}\n\n`.repeat(13).trim() }}
    />
  ),
};

export const DraftedByAnAgent: StoryObj<CreateAgentFormProps> = {
  render: () => (
    <FormStory
      agents={THREE_AGENTS}
      initialValues={{
        name: "Nora",
        title: "Family calendar and school logistics",
        instruction:
          "You handle our family logistics: school pickups, after-school classes, camp sign-ups and the family calendar. The kids' notes are in Family/Kids/. Check the calendar before you suggest a time. Answer in short lines I can read on my phone.",
      }}
      draftedBy={{ name: COCO.name, faceSrc: COCO.faceSrc }}
    />
  ),
};
