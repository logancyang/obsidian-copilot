import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

export interface IntelligentUiSettingProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function IntelligentUiSetting({ checked, onCheckedChange }: IntelligentUiSettingProps) {
  return (
    <SettingItem
      type="switch"
      title="Intelligent UI"
      description="Show richer visual layouts in AI answers. Saved notes remain Markdown."
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  );
}
