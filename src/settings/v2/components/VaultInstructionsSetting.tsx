import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { InstructionsTextarea } from "@/instructions/InstructionsTextarea";
import { ArrowUpRight } from "lucide-react";
import React from "react";

export interface VaultInstructionsSettingProps {
  value: string;
  onChange: (next: string) => void;
  onOpen: () => void;
}

/**
 * Presents vault-wide agent instructions while leaving vault file operations to its host.
 */
export const VaultInstructionsSetting: React.FC<VaultInstructionsSettingProps> = ({
  value,
  onChange,
  onOpen,
}) => (
  <div className="tw-flex tw-w-full tw-flex-col tw-gap-4 tw-py-4">
    <div className="tw-grid tw-w-full tw-grid-cols-[minmax(0,1fr)_auto] tw-items-center tw-gap-4">
      <div className="tw-space-y-1.5">
        <div className="tw-text-sm tw-font-medium tw-leading-none">
          {t("settings.basic.instructions.title")}
        </div>
        <div className="tw-text-xs tw-text-muted">
          {t("settings.basic.instructions.description")}
        </div>
      </div>
      <Button variant="secondary" onClick={onOpen}>
        <ArrowUpRight className="tw-size-4" />
        {t("settings.basic.instructions.open")}
      </Button>
    </div>
    <InstructionsTextarea
      label={t("settings.basic.instructions.title")}
      value={value}
      onChange={onChange}
    />
  </div>
);
