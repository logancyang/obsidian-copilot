import { SettingItem } from "@/components/ui/setting-item";
import type { ClaudeAutoModePermission } from "@/settings/model";
import React from "react";

const AUTO_MODE_OPTIONS: { label: string; value: ClaudeAutoModePermission }[] = [
  { label: "Auto", value: "auto" },
  { label: "Accept edits", value: "acceptEdits" },
  { label: "Bypass permissions", value: "bypassPermissions" },
];

export interface ClaudeAutoModePermissionSettingProps {
  value: ClaudeAutoModePermission;
  onChange: (value: ClaudeAutoModePermission) => void;
}

/** Presentational settings row for choosing what Claude's canonical Auto mode permits. */
export const ClaudeAutoModePermissionSetting: React.FC<ClaudeAutoModePermissionSettingProps> = ({
  value,
  onChange,
}) => (
  <SettingItem
    type="select"
    title="Auto mode permissions"
    description="Auto lets Claude judge each request and still ask about risky ones, Accept edits auto-approves file edits only, and Bypass permissions skips every check."
    value={value}
    options={AUTO_MODE_OPTIONS}
    onChange={(next) => onChange(next as ClaudeAutoModePermission)}
  />
);
