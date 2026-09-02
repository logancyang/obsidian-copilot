import { FormField } from "@/components/ui/form-field";
import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import React from "react";
import { t } from "@/i18n";

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
}) => {
  const label = t("agentChat.projects.instructions");
  return (
    <FormField label={label} description={t("agentChat.projects.instructionsHelp")}>
      <InstructionsTextarea label={label} value={value} onChange={onChange} />
    </FormField>
  );
};
