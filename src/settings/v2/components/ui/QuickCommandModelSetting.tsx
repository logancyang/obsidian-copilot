import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

export interface QuickCommandModelSettingProps {
  value: string | undefined;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

export function QuickCommandModelSetting({
  value,
  options,
  onChange,
}: QuickCommandModelSettingProps) {
  return (
    <SettingItem
      type="select"
      title="Default quick command model"
      description="Used by Quick Ask, Quick Command, and saved commands set to Default model."
      value={value ?? ""}
      onChange={onChange}
      options={[{ label: "Select Model", value: "" }, ...options]}
    />
  );
}
