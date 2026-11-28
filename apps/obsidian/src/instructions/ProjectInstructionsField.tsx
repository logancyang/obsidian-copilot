import { FormField } from "@/components/ui/form-field";
import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import React from "react";

const LABEL = "Project instructions";

export interface ProjectInstructionsFieldProps {
  value: string;
  onChange: (next: string) => void;
}

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
