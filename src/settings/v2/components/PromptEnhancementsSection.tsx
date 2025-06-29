import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { DEFAULT_SYSTEM_PROMPT } from "@/constants";

export function PromptEnhancementsSection() {
  const settings = useSettingsValue();
  const [autoFollowUpEnabled, setAutoFollowUpEnabled] = useState(
    settings.promptEnhancements?.autoFollowUp?.enabled || false
  );
  const [followUpPrompt, setFollowUpPrompt] = useState(
    settings.promptEnhancements?.autoFollowUp?.prompt || ""
  );

  // 自动语音播放状态
  const [autoSpeechEnabled, setAutoSpeechEnabled] = useState(
    settings.promptEnhancements?.autoSpeech?.enabled || false
  );
  const [speechPrompt, setSpeechPrompt] = useState(
    settings.promptEnhancements?.autoSpeech?.prompt || ""
  );
  // 新增：是否拼接默认系统提示词
  const [appendDefaultPrompt, setAppendDefaultPrompt] = useState(
    settings.promptEnhancements?.appendDefaultPrompt ?? true
  );

  const [isPromptExpanded, setIsPromptExpanded] = useState(false);

  const [useOralPrompt, setUseOralPrompt] = useState(
    settings.promptEnhancements?.autoSpeech?.useOralPrompt ?? true // 默认开启
  );

  // 初始化时加载设置
  useEffect(() => {
    setAutoFollowUpEnabled(settings.promptEnhancements?.autoFollowUp?.enabled || false);
    setFollowUpPrompt(settings.promptEnhancements?.autoFollowUp?.prompt || "");
    setAutoSpeechEnabled(settings.promptEnhancements?.autoSpeech?.enabled || false);
    setSpeechPrompt(settings.promptEnhancements?.autoSpeech?.prompt || "");
    setAppendDefaultPrompt(settings.promptEnhancements?.appendDefaultPrompt ?? true);
    setUseOralPrompt(settings.promptEnhancements?.autoSpeech?.useOralPrompt ?? true);
  }, [settings.promptEnhancements]);

  // 新增：处理默认提示词拼接开关变化
  const handleAppendDefaultPromptChange = (checked: boolean) => {
    setAppendDefaultPrompt(checked);
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      appendDefaultPrompt: checked,
    });
  };
  // 保存设置
  const saveFollowUpSettings = () => {
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      autoFollowUp: {
        enabled: autoFollowUpEnabled,
        prompt: followUpPrompt.trim(),
      },
    });
  };

  // 保存自动语音播放设置
  const saveSpeechSettings = () => {
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      autoSpeech: {
        enabled: autoSpeechEnabled,
        prompt: speechPrompt.trim(),
        useOralPrompt, // 新增
      },
    });
  };

  // 新增切换处理函数
  const handleOralPromptToggleChange = (checked: boolean) => {
    setUseOralPrompt(checked);
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      autoSpeech: {
        ...settings.promptEnhancements?.autoSpeech,
        useOralPrompt: checked,
        // prompt: settings.promptEnhancements?.autoSpeech?.prompt || "", // 保持原有提示词
      },
    });
  };

  // 自动衍生问题开关变化
  const handleFollowUpToggleChange = (checked: boolean) => {
    setAutoFollowUpEnabled(checked);
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      autoFollowUp: {
        enabled: checked,
        prompt: settings.promptEnhancements?.autoFollowUp?.prompt || "",
      },
    });
  };

  // 自动语音播放开关变化
  const handleSpeechToggleChange = (checked: boolean) => {
    setAutoSpeechEnabled(checked);
    updateSetting("promptEnhancements", {
      ...settings.promptEnhancements,
      autoSpeech: {
        ...settings.promptEnhancements?.autoSpeech,
        enabled: checked,
        // prompt: settings.promptEnhancements?.autoSpeech?.prompt || "", // 保持原有提示词
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4 p-4 border rounded-lg">
        <div className="flex items-center justify-between">
          <SettingItem
            type="switch"
            title="拼接默认系统提示词"
            description="是否在对话中使用默认系统提示词"
            checked={appendDefaultPrompt}
            onCheckedChange={handleAppendDefaultPromptChange}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsPromptExpanded(!isPromptExpanded)}
            className="text-sm"
          >
            {isPromptExpanded ? "隐藏" : "查看"}默认提示词
          </Button>
        </div>

        {isPromptExpanded && (
          <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-md">
            <div className="font-medium text-sm mb-2">默认系统提示词内容：</div>
            <div className="whitespace-pre-wrap text-sm max-w-3xl">{DEFAULT_SYSTEM_PROMPT}</div>
          </div>
        )}
      </div>
      {/* 自动衍生问题部分 */}
      <div className="space-y-4 p-4 border rounded-lg">
        <div className="flex items-center justify-between">
          <SettingItem
            type="switch"
            title="自动衍生问题"
            description="开启后会在对话中自动生成相关问题建议"
            checked={autoFollowUpEnabled}
            onCheckedChange={handleFollowUpToggleChange}
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
            <Button onClick={saveFollowUpSettings}>保存提示词</Button>
          </div>
        )}
      </div>

      {/* 自动语音播放部分 */}
      <div className="space-y-4 p-4 border rounded-lg">
        {/* 第一行：自动语音播放开关 */}
        <div className="flex items-center justify-between">
          <SettingItem
            type="switch"
            title="自动语音播放"
            description="开启后会在对话中自动播放AI回复的语音"
            checked={autoSpeechEnabled}
            onCheckedChange={handleSpeechToggleChange}
          />
        </div>

        {/* 第二行：口语化提示词开关 */}
        <div className="flex items-center justify-between">
          <SettingItem
            type="switch"
            title="使用口语化提示词"
            description="开启后会在语音播放前添加口语化提示词"
            checked={useOralPrompt}
            onCheckedChange={handleOralPromptToggleChange}
          />
        </div>

        {useOralPrompt && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>语音提示词</Label>
              <Textarea
                value={speechPrompt}
                onChange={(e) => setSpeechPrompt(e.target.value)}
                placeholder="输入语音播放的提示词"
                className="min-h-[100px]"
              />
              <Button onClick={saveSpeechSettings}>保存提示词</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
