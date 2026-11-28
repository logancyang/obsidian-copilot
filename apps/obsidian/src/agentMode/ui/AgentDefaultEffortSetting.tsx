import type { EffortOption } from "@/agentMode/session/types";
import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

export interface AgentDefaultEffortSettingProps {
  value: string | null;
  options: EffortOption[];
  disabledLabel: string;
  onChange: (effort: string | null) => void;
}

export function AgentDefaultEffortSetting({
  value,
  options,
  disabledLabel,
  onChange,
}: AgentDefaultEffortSettingProps) {
  const supported = options.length > 0;
  const selectOptions = supported
    ? options.map((option) => ({ label: option.label, value: option.value ?? "" }))
    : [{ label: disabledLabel, value: "" }];

  return (
    <SettingItem
      type="select"
      title="Default effort"
      value={supported ? (value ?? "") : ""}
      onChange={(nextValue) => onChange(nextValue === "" ? null : nextValue)}
      options={selectOptions}
      disabled={!supported}
    />
  );
}
