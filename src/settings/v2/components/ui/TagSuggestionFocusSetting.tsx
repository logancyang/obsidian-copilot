import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

export interface TagSuggestionFocusSettingProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function TagSuggestionFocusSetting({
  checked,
  onCheckedChange,
}: TagSuggestionFocusSettingProps) {
  return (
    <SettingItem
      type="switch"
      title="Suggest tags when I click into the tags property"
      description="Sends this note's details to Brevilabs to rank your existing tags. Turn off to suggest tags only from the command."
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  );
}
