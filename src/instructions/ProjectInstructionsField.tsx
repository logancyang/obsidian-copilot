import { FormField } from "@/components/ui/form-field";
import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import React from "react";

const LABEL = "Project instructions";

export interface ProjectInstructionsFieldProps {
  /** The project's AGENTS.md draft. */
  value: string;
  onChange: (next: string) => void;
}

/**
 * The Edit Project dialog's instruction field: the project's AGENTS.md draft, with the copy
 * explaining where the text lands and how it ranks against the vault-wide file.
 *
 * Split from the dialog so the state it introduces is renderable on its own — the dialog around
 * it cannot mount without a live project record, which would put this field out of reach of the
 * component gallery.
 */
export const ProjectInstructionsField: React.FC<ProjectInstructionsFieldProps> = ({
  value,
  onChange,
}) => (
  <FormField
    label={LABEL}
    description="Your custom instructions for the agent to follow for every interaction in this project. They take precedence over your vault instructions wherever the two conflict. Saved to AGENTS.md in the project folder, which you can also edit as a note."
  >
    <InstructionsTextarea label={LABEL} value={value} onChange={onChange} />
  </FormField>
);
