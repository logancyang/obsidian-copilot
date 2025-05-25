import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopilotSettings, updateSetting, useSettingsValue } from "@/settings/model";

type CharacterTrait = Record<string, string>;
type SelectedValues = Record<string, string | undefined>;
type CheckedItems = Record<string, boolean>;

interface CharacterPreset {
  id: string;
  name: string;
  prompt: string;
  isActive: boolean;
}

// 1. 首先修改 DynamicTraitEditor 的 props 类型
interface DynamicTraitEditorProps {
  traits: CharacterTrait;
  onTraitsChange: (traits: CharacterTrait) => void;
  updateSystemPrompts: (updates: Partial<CopilotSettings["systemPrompts"]>) => void;
}

export function SystemPromptsSection() {
  const settings = useSettingsValue();
  const [isExpanded, setIsExpanded] = useState(true);
  // const [localPrompt, setLocalPrompt] = useState(settings.userSystemPrompt || "");
  const [presetName, setPresetName] = useState(""); // 新增：人设名称状态
  const [presets, setPresets] = useState<CharacterPreset[]>(settings.systemPrompts?.presets || []); // 新增：人设列表状态
  // 初始化时加载保存的人设
  useEffect(() => {
    setPresets(settings.systemPrompts?.presets || []);
  }, [settings.systemPrompts?.presets]);

  // 修改 applyCharacterSettings 函数
  const applyCharacterSettings = () => {
    if (!presetName.trim()) return; // 需要有人设名称

    const traits = settings.systemPrompts?.activeTraits || {};
    const checkedItems = settings.systemPrompts?.checkedItems || {};
    const selectedValues = settings.systemPrompts?.selectedValues || {};

    const promptText = Object.entries(traits)
      .filter(([key]) => checkedItems[key] === true)
      .map(([key]) => {
        const selectedValue = selectedValues[key];
        const firstValue = traits[key]?.split("|")[0] || "";
        return `${key}: ${selectedValue || firstValue}`;
      })
      .join("\n");

    // 更新本地状态和全局设置
    // setLocalPrompt(promptText);
    updateSetting("userSystemPrompt", promptText);

    // 保存新人设
    const newPreset: CharacterPreset = {
      id: Date.now().toString(),
      name: presetName,
      prompt: promptText,
      isActive: true, // 默认激活新人设
    };

    // 更新人设列表，设置新人设为活跃，其他为非活跃
    const updatedPresets = presets.map((p) => ({ ...p, isActive: false }));
    updatedPresets.push(newPreset);

    setPresets(updatedPresets);
    updateSystemPrompts({
      presets: updatedPresets,
    });

    setPresetName(""); // 清空名称输入框
  };

  // 新增：处理人设选择
  const handleSelectPreset = (id: string) => {
    const updatedPresets = presets.map((preset) => ({
      ...preset,
      isActive: preset.id === id,
    }));

    // 找到选中的人设
    const selectedPreset = updatedPresets.find((p) => p.isActive);

    if (selectedPreset) {
      // setLocalPrompt(selectedPreset.prompt);
      updateSetting("userSystemPrompt", selectedPreset.prompt);
    }

    setPresets(updatedPresets);
    updateSystemPrompts({
      presets: updatedPresets,
    });
  };

  // 新增：处理人设删除
  const handleDeletePreset = (id: string) => {
    const updatedPresets = presets.filter((p) => p.id !== id);

    // 如果删除的是当前活跃的人设，重置系统提示
    const deletedPreset = presets.find((p) => p.id === id);
    if (deletedPreset?.isActive) {
      // setLocalPrompt("");
      updateSetting("userSystemPrompt", "");
    }

    setPresets(updatedPresets);
    updateSystemPrompts({
      presets: updatedPresets,
    });
  };

  // 新增：处理人设提示词更新
  const handleUpdatePresetPrompt = (id: string, prompt: string) => {
    const updatedPresets = presets.map((preset) => {
      if (preset.id === id) {
        return { ...preset, prompt };
      }
      return preset;
    });

    // 如果更新的是当前活跃的人设，更新系统提示
    const updatedPreset = updatedPresets.find((p) => p.id === id);
    if (updatedPreset?.isActive) {
      // setLocalPrompt(prompt);
      updateSetting("userSystemPrompt", prompt);
    }

    setPresets(updatedPresets);
    updateSystemPrompts({
      presets: updatedPresets,
    });
  };

  const updateSystemPrompts = (updates: Partial<CopilotSettings["systemPrompts"]>) => {
    updateSetting("systemPrompts", {
      default: "",
      ...settings.systemPrompts,
      ...updates,
    });
  };
  // 修改后的 handleTraitsChange
  const handleTraitsChange = (traits: CharacterTrait) => {
    // 初始化 checkedItems 和 selectedValues
    const newCheckedItems: CheckedItems = {};
    const newSelectedValues: SelectedValues = {};

    Object.entries(traits).forEach(([key, value]) => {
      const values = value.split("|");
      if (values.length > 0) {
        newCheckedItems[key] = true;
        newSelectedValues[key] = values[0];
      }
    });

    updateSystemPrompts({
      activeTraits: traits,
      checkedItems: newCheckedItems,
      selectedValues: newSelectedValues,
    });
  };

  return (
    <div className="space-y-4 border border-red-500">
      {/* <SettingItem
      type="textarea"
      title="Default System Prompt"
      description="Initial instructions for the AI assistant"
      value={localPrompt}
      onChange={(value) => {
        setLocalPrompt(value);
        updateSetting("userSystemPrompt", value);
      }}
      placeholder="You are a helpful assistant..."
      rows={4}
      className="w-full"
    /> */}

      {/* 人设列表 - 移出可折叠区域 */}
      <div className="border-t pt-6">
        <h3 className="text-lg font-medium mb-2">人设列表(用于配置系统提示词)</h3>
        {presets.length > 0 ? (
          <div className="space-y-2">
            {" "}
            {/* 缩小间距从space-y-4到space-y-2 */}
            {presets.map((preset) => (
              <div key={preset.id} className="p-3 border rounded">
                {" "}
                {/* 缩小内边距从p-4到p-3 */}
                <div className="flex flex-col gap-2">
                  {" "}
                  {/* 改为flex-col布局 */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={preset.isActive}
                        onChange={() => handleSelectPreset(preset.id)}
                        className="h-4 w-4"
                      />
                      <span className="font-medium">{preset.name}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleDeletePreset(preset.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {/* 将文本框放在同一行并缩小高度 */}
                  <textarea
                    value={preset.prompt}
                    onChange={(e) => handleUpdatePresetPrompt(preset.id, e.target.value)}
                    className="w-full h-16 p-2 border rounded" // 进一步缩小高度到h-16
                    placeholder="Character prompt..."
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground">尚未创建任何人设</div>
        )}
      </div>

      {/* 可折叠的高级管理区域 - 仅保留人设调试板 */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              {isExpanded ? (
                <>
                  <ChevronUp className="mr-2 h-2 w-4" />
                  隐藏调试板
                </>
              ) : (
                <>
                  <ChevronDown className="mr-2 h-2 w-4" />
                  打开调试板
                </>
              )}
            </Button>
          </CollapsibleTrigger>
        </div>

        {/* 修改 CollapsibleContent 部分的代码 */}
        <CollapsibleContent className="space-y-2 mt-1">
          {" "}
          {/* 修改为 space-y-2 和 mt-1 */}
          {/* 人设调试板 */}
          <div className="border-t pt-4">
            {" "}
            {/* 修改 pt-6 为 pt-4 */}
            <h3 className="text-lg font-medium mb-2">人设调试板</h3> {/* 修改 mb-4 为 mb-2 */}
            <DynamicTraitEditor
              traits={settings.systemPrompts?.activeTraits || {}}
              onTraitsChange={handleTraitsChange}
              updateSystemPrompts={updateSystemPrompts}
            />
            {/* 修改应用按钮区域 */}
            <div className="flex gap-2 items-center mt-2">
              {" "}
              {/* 修改 mt-4 为 mt-2 */}
              <Button onClick={applyCharacterSettings} disabled={!presetName.trim()}>
                应用人设
              </Button>
              <input
                placeholder="名称"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="flex-1 p-2 border rounded"
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// 修改 DynamicTraitEditor 组件
const DynamicTraitEditor: React.FC<DynamicTraitEditorProps> = ({
  traits,
  onTraitsChange,
  updateSystemPrompts,
}) => {
  const settings = useSettingsValue();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const checkedItems = settings.systemPrompts?.checkedItems || {};
  const selectedValues = settings.systemPrompts?.selectedValues || {};

  // 保持原有处理函数不变，现在可以正常使用 updateSystemPrompts
  const handleValueSelectChange = (key: string, value: string) => {
    updateSystemPrompts({
      selectedValues: {
        ...selectedValues,
        [key]: value,
      },
    });
  };
  // 处理复选框变化
  const handleCheckboxChange = (key: string, checked: boolean) => {
    updateSystemPrompts({
      checkedItems: {
        ...checkedItems,
        [key]: checked,
      },
    });
  };

  const handleRemoveValue = (key: string) => {
    const currentValues = traits[key]?.split("|") || [];
    const selectedValue = selectedValues[key];

    if (selectedValue) {
      // 删除选中的值
      const newValues = currentValues.filter((v) => v !== selectedValue);

      if (newValues.length > 0) {
        // 更新 traits 数据
        onTraitsChange({
          ...traits,
          [key]: newValues.join("|"),
        });

        // 自动选择第一个值
        updateSystemPrompts({
          selectedValues: {
            ...selectedValues,
            [key]: newValues[0],
          },
        });
      } else {
        // 如果删除后没有值了，删除整个特征
        const newTraits = { ...traits };
        delete newTraits[key];
        onTraitsChange(newTraits);

        // 清除相关状态
        updateSystemPrompts({
          selectedValues: {
            ...selectedValues,
            [key]: undefined,
          },
          checkedItems: {
            ...checkedItems,
            [key]: undefined,
          },
        });
      }
    }
  };

  const handleAddTrait = () => {
    if (!newKey.trim() || !newValue.trim()) return;

    // 初始化新特征的状态
    updateSystemPrompts({
      selectedValues: {
        ...selectedValues,
        [newKey]: newValue,
      },
      checkedItems: {
        ...checkedItems,
        [newKey]: true,
      },
    });

    // 更新 traits 数据
    const currentValues = traits[newKey] ? traits[newKey].split("|") : [];
    currentValues.push(newValue);
    onTraitsChange({
      ...traits,
      [newKey]: currentValues.join("|"),
    });

    setNewKey("");
    setNewValue("");
  };

  return (
    <div className="space-y-4">
      {Object.entries(traits).map(([key, value]) => {
        const values = value.split("|");
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={checkedItems[key] || false}
                onChange={(e) => handleCheckboxChange(key, e.target.checked)}
                className="h-4 w-4"
              />
              <span className="font-medium">{key}:</span>
              <select
                value={selectedValues[key] || values[0] || ""}
                onChange={(e) => handleValueSelectChange(key, e.target.value)}
                className="flex-1 p-2 border rounded"
              >
                {values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <Button variant="ghost" size="sm" onClick={() => handleRemoveValue(key)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <input
                placeholder={`添加新的${key}值`}
                value={newKey === key ? newValue : ""}
                onChange={(e) => {
                  setNewKey(key);
                  setNewValue(e.target.value);
                }}
                className="flex-1 p-2 border rounded"
              />
              <Button
                onClick={() => {
                  setNewKey(key);
                  handleAddTrait();
                }}
                disabled={!newValue.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}

      {/* 添加新特征的输入区域 */}
      <div className="border-t pt-4">
        <div className="flex gap-2">
          <input
            placeholder="特征名称 (如: 角色)"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="flex-1 p-2 border rounded"
          />
          <input
            placeholder="特征值 (如: 哲学家)"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="flex-1 p-2 border rounded"
          />
          <Button onClick={handleAddTrait} disabled={!newKey.trim() || !newValue.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
