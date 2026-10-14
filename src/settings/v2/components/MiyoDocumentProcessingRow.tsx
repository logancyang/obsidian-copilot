import { SettingSwitch } from "@/components/ui/setting-switch";
import { CapabilityRow } from "@/settings/v2/components/CapabilityRow";
import React from "react";

export interface MiyoDocumentProcessingRowProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export const MiyoDocumentProcessingRow: React.FC<MiyoDocumentProcessingRowProps> = ({
  enabled,
  onEnabledChange,
}) => (
  <CapabilityRow
    title="Miyo document processing"
    description="Miyo parses PDF and EPUB files on your computer."
    control={
      <SettingSwitch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        aria-label="Enable Miyo document processing"
      />
    }
  />
);
