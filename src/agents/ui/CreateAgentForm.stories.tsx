import {
  CreateAgentCloseGuard,
  CreateAgentForm,
  type CreateAgentFormProps,
} from "@/agents/ui/CreateAgentForm";
import { COCO, LEO, MAYA, NORA } from "@/agents/ui/testing/rosterFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useEffect, useRef } from "react";

const KAI_INSTRUCTION =
  'You handle marketing for Obsidian Copilot: release posts, the newsletter, launch videos and Discord announcements. Release notes are in copilot/releases/ and past newsletters in marketing/newsletter/. Lead with what the user can now do, not the feature list. Plain words, short sentences, no hype words like "supercharge". Give me one draft, not three options.';

const KAI = {
  name: "Kai",
  title: "Writes launch posts and the newsletter",
  instruction: KAI_INSTRUCTION,
};

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
          agents={[COCO, MAYA, LEO, NORA]}
          folderNames={(props.agents ?? [COCO, MAYA, LEO, NORA]).map((agent) => agent.slug)}
          agentsFolder="copilot/agents"
          closeGuard={new CreateAgentCloseGuard()}
          onCreate={async () => {}}
          onClose={() => {}}
          {...props}
        />
      </div>
    </TooltipProvider>
  );
}

function leaveInstructionEmpty(form: HTMLElement) {
  const instruction = form.querySelector("textarea");
  instruction?.focus();
  instruction?.blur();
}

const meta = {
  title: "Custom Agents/Create Agent Dialog",
  component: CreateAgentForm,
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CreateAgentFormProps>;
export default meta;

export const Empty: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory />,
};

export const Filled: StoryObj<CreateAgentFormProps> = {
  render: () => <FormStory initialValues={KAI} />,
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
