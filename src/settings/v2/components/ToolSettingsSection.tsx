import React from "react";
import { SettingItem } from "@/components/ui/setting-item";
import { ToolRegistry } from "@/tools/ToolRegistry";
import { updateSetting, useSettingsValue } from "@/settings/model";

export const ToolSettingsSection: React.FC = () => {
  const settings = useSettingsValue();
  const registry = ToolRegistry.getInstance();

  const enabledToolIds = new Set(settings.autonomousAgentEnabledToolIds || []);

  // Get configurable tools grouped by category
  const toolsByCategory = registry.getToolsByCategory();
  const configurableTools = registry.getConfigurableTools();

  const handleToolToggle = (toolId: string, enabled: boolean) => {
    const newEnabledIds = new Set(enabledToolIds);
    if (enabled) {
      newEnabledIds.add(toolId);
    } else {
      newEnabledIds.delete(toolId);
    }

    updateSetting("autonomousAgentEnabledToolIds", Array.from(newEnabledIds));
  };

  const renderToolsByCategory = () => {
    const categories = Array.from(toolsByCategory.entries()).filter(([_, tools]) =>
      tools.some((t) => configurableTools.includes(t))
    );

    return categories.map(([category, tools]) => {
      const configurableInCategory = tools.filter((t) => configurableTools.includes(t));

      if (configurableInCategory.length === 0) return null;

      return (
        <div key={category} className="tw-mb-4">
          <div className="tw-mb-2 tw-text-xs tw-font-medium tw-uppercase tw-text-muted">
            {category}
          </div>
          {configurableInCategory.map(({ metadata }) => (
            <SettingItem
              key={metadata.id}
              type="switch"
              title={metadata.displayName}
              description={metadata.description}
              checked={enabledToolIds.has(metadata.id)}
              onCheckedChange={(checked) => handleToolToggle(metadata.id, checked)}
            />
          ))}
        </div>
      );
    });
  };

  return (
    <>
      <SettingItem
        type="slider"
        title="Max Iterations"
        description="Maximum number of reasoning iterations the autonomous agent can perform. Higher values allow for more complex reasoning but may take longer."
        value={settings.autonomousAgentMaxIterations ?? 4}
        onChange={(value) => {
          updateSetting("autonomousAgentMaxIterations", value);
        }}
        min={4}
        max={8}
        step={1}
      />

      <div className="tw-mb-2 tw-mt-4 tw-text-sm tw-font-medium">Available Tools</div>
      <div className="tw-mb-4 tw-text-xs tw-text-muted">
        Toggle which tools the autonomous agent can use
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">{renderToolsByCategory()}</div>
    </>
  );
};
