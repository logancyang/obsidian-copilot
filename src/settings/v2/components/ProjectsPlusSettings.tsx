import { SettingItem } from "@/components/ui/setting-item";
import { updateSetting, useSettingsValue } from "@/settings/model";
import React from "react";

/**
 * Settings section for Projects+ feature configuration
 */
export const ProjectsPlusSettings: React.FC = () => {
  const settings = useSettingsValue();

  return (
    <>
      <div className="tw-pt-4 tw-text-xl tw-font-semibold">Projects+</div>

      <SettingItem
        type="text"
        title="Projects Folder"
        description="Folder where project data is stored. Each project creates a subfolder here."
        value={settings.projectsPlusFolder}
        onChange={(value) => updateSetting("projectsPlusFolder", value)}
        placeholder="copilot/projects"
      />

      <div className="tw-rounded tw-bg-secondary tw-p-3 tw-text-sm tw-text-muted">
        <strong>Note:</strong> Projects+ uses the same inclusion/exclusion settings as QA Mode for
        note suggestions. Configure them in the <strong>QA</strong> settings tab.
      </div>
    </>
  );
};
