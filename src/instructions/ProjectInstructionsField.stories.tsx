import {
  ProjectInstructionsField,
  type ProjectInstructionsFieldProps,
} from "./ProjectInstructionsField";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Instructions/Project Instructions Field",
  component: ProjectInstructionsField,
  args: { value: "", onChange: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ProjectInstructionsFieldProps>;
export default meta;

/**
 * A project whose AGENTS.md is empty, or which has none yet. The field is only rendered once the
 * draft has been read, so this empty box means "no instructions", never "still loading".
 */
export const EmptyDraft: StoryObj<ProjectInstructionsFieldProps> = {};

/** A project that already has instructions, including ones moved out of the legacy `project.md`. */
export const LoadedDraft: StoryObj<ProjectInstructionsFieldProps> = {
  args: {
    value:
      "Cite only notes tagged #verified.\n\nWhen summarizing an interview, keep the participant's own wording for anything in quotes.",
  },
};

/** A long body scrolls inside the field rather than stretching the dialog past its scroll area. */
export const OverflowingDraft: StoryObj<ProjectInstructionsFieldProps> = {
  args: {
    value: Array.from(
      { length: 12 },
      (_, i) => `${i + 1}. Rule the agent follows for every interaction in this project.`
    ).join("\n"),
  },
};
