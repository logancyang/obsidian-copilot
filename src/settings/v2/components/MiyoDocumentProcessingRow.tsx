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
    description="Agent Chat parses PDF and EPUB files with Miyo on your computer; Quick Chat sends them to your connected Miyo service, local or remote. When off, Agent Chat can use the Copilot PDF skill and Quick Chat uses Copilot Cloud, which may use paid credits."
    control={
      <SettingSwitch
        checked={enabled}
        onCheckedChange={onEnabledChange}
        aria-label="Enable Miyo document processing"
      />
    }
  />
);
