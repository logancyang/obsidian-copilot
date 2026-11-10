import { EditProjectForm, type EditProjectFormProps } from "@/projects/ui/EditProjectModal";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Edit Project Dialog",
  component: EditProjectForm,
  args: {
    name: "Fall product launch",
    description: "Plan the launch, track open questions and draft the announcement",
    instructions:
      "Put new drafts in outputs/ and link each one to the launch brief. Ask before editing notes outside the project folder.",
    showNameError: false,
    isSubmitting: false,
    onNameChange: () => {},
    onNameBlur: () => {},
    onDescriptionChange: () => {},
    onInstructionsChange: () => {},
    onSave: () => {},
    onCancel: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<EditProjectFormProps>;
export default meta;

export const Filled: StoryObj<EditProjectFormProps> = {};

export const MissingName: StoryObj<EditProjectFormProps> = {
  args: { name: "", showNameError: true },
};

export const Saving: StoryObj<EditProjectFormProps> = {
  args: { isSubmitting: true },
};

export const WithoutProjectFolder: StoryObj<EditProjectFormProps> = {
  args: { instructions: null },
};
