import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSetting, useSettingsValue } from "@/settings/model";

export function PromptEnhancementsSection() {
  const settings = useSettingsValue();
  const [autoFollowUpEnabled, setAutoFollowUpEnabled] = useState(
    settings.promptEnhancements?.autoFollowUp?.enabled || false
  );
  const [followUpPrompt, setFollowUpPrompt] = useState(
    settings.promptEnhancements?.autoFollowUp?.prompt || ""
  );

  // 初始化时加载设置
  useEffect(() => {
    setAutoFollowUpEnabled(settings.promptEnhancements?.autoFollowUp?.enabled || false);
    setFollowUpPrompt(settings.promptEnhancements?.autoFollowUp?.prompt || "");
  }, [settings.promptEnhancements?.autoFollowUp]);

  // 保存设置
  const saveSettings = () => {
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      autoFollowUp: {
        enabled: autoFollowUpEnabled,
        prompt: followUpPrompt.trim(),
      },
    });
  };

  // 开关变化时自动保存
  const handleToggleChange = (checked: boolean) => {
    setAutoFollowUpEnabled(checked);
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      autoFollowUp: {
        enabled: checked,
        prompt: settings.promptEnhancements?.autoFollowUp?.prompt || "", // 添加默认值
      },
    });
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      <div className="flex items-center justify-between">
        <SettingItem
          type="switch"
          title="自动衍生问题"
          description="开启后会在对话中自动生成相关问题建议"
          checked={autoFollowUpEnabled}
          onCheckedChange={handleToggleChange}
        />
      </div>

      {autoFollowUpEnabled && (
        <div className="space-y-2">
          <Label>衍生问题提示词</Label>
          <Textarea
            value={followUpPrompt}
            onChange={(e) => setFollowUpPrompt(e.target.value)}
            placeholder="输入自动生成问题的提示词 (例如: '基于当前对话内容，生成3个可能的后续问题:')"
            className="min-h-[100px]"
          />
          <Button onClick={saveSettings}>保存提示词</Button>
        </div>
      )}
    </div>
  );
}
