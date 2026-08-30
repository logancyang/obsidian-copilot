import type { EffortOption } from "@/agentMode/session/types";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/i18n";
import React from "react";

export interface AgentDefaultEffortSettingProps {
  value: string | null;
  options: EffortOption[];
  disabledLabel: string;
  onChange: (effort: string | null) => void;
}

/**
 * Stable settings row for a backend's default effort. Capability changes only
 * enable or disable its select so the model list below never shifts vertically.
 *
 * @param props - Current effort state and the options exposed by the selected model.
 */
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
      title={t("settings.agents.defaultEffort.title")}
      value={supported ? (value ?? "") : ""}
      onChange={(nextValue) => onChange(nextValue === "" ? null : nextValue)}
      options={selectOptions}
      disabled={!supported}
    />
  );
}
