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

// 修改 DynamicTraitEditor 组件 props 类型
interface DynamicTraitEditorProps {
  traits: CharacterTrait;
  onTraitsChange: (traits: CharacterTrait) => void;
  updateSystemPrompts: (updates: Partial<CopilotSettings["systemPrompts"]>) => void;
  selectedValues: SelectedValues; // 新增 prop
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
    const traitOrder = settings.systemPrompts?.traitOrder || Object.keys(traits);

    // 按保存的顺序拼接提示词
    const promptText = traitOrder
      .filter((key) => checkedItems[key] === true)
      .map((key) => {
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
  // 修改 handleTraitsChange 函数
  const handleTraitsChange = (newTraits: CharacterTrait) => {
    // 修改 handleTraitsChange 函数中的相关代码
    const currentSettings = settings.systemPrompts || {
      checkedItems: {},
      selectedValues: {},
      traitOrder: [],
    };

    // 保留现有的 checkedItems 和 selectedValues
    const newCheckedItems: CheckedItems = { ...(currentSettings?.checkedItems || {}) };
    const newSelectedValues: SelectedValues = { ...(currentSettings?.selectedValues || {}) };

    // 只初始化新增特征的 checkedItems 和 selectedValues
    Object.entries(newTraits).forEach(([key, value]) => {
      if (!(key in newCheckedItems)) {
        newCheckedItems[key] = true; // 默认选中新增特征
      }
      if (!(key in newSelectedValues)) {
        const values = value.split("|");
        if (values.length > 0) {
          newSelectedValues[key] = values[0]; // 默认选择第一个值
        }
      }
    });

    // 移除已删除特征的 checkedItems 和 selectedValues
    Object.keys(newCheckedItems).forEach((key) => {
      if (!(key in newTraits)) {
        delete newCheckedItems[key];
      }
    });
    Object.keys(newSelectedValues).forEach((key) => {
      if (!(key in newTraits)) {
        delete newSelectedValues[key];
      }
    });

    // 更新 order，保留现有顺序，添加新key到末尾
    const currentKeys = Object.keys(newTraits);
    const newOrder = [
      ...(currentSettings.traitOrder || []).filter((key) => currentKeys.includes(key)),
      ...currentKeys.filter((key) => !(currentSettings.traitOrder || []).includes(key)),
    ];

    updateSystemPrompts({
      activeTraits: newTraits,
      checkedItems: newCheckedItems,
      selectedValues: newSelectedValues,
      traitOrder: newOrder,
    });
  };

  return (
    <div className="tw-space-y-4 tw-border tw-border-red-500">
      {/* 可折叠的高级管理区域 - 仅保留人设调试板 */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="tw-flex tw-items-center tw-justify-between">
          <CollapsibleTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              className="tw-text-muted-foreground tw-text-base"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="tw-mr-2 tw-h-4 tw-w-4" />
                  隐藏调试板
                </>
              ) : (
                <>
                  <ChevronDown className="tw-mr-2 tw-h-4 tw-w-4" />
                  打开调试板
                </>
              )}
            </Button>
          </CollapsibleTrigger>
        </div>

        {/* 修改 CollapsibleContent 部分的代码 */}
        <CollapsibleContent className="tw-space-y-2">
          {/* 人设调试板 */}
          <div className="tw-border-t tw-pt-2">
            <h3 className="tw-text-lg tw-font-medium tw-mb-2">人设调试板</h3>

            {/* 修改应用按钮区域 - 将添加人设按钮移到前面 */}
            <div className="tw-flex tw-gap-2 tw-items-center tw-mb-4">
              {/* 添加 mb-4 下边距 */}
              <input
                placeholder="人设名称（用于人设列表中标识系统提示词）"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                // className="tw-w-[300px] tw-p-2 tw-border tw-rounded"
                className="tw-w-[300px] tw-p-2 tw-border tw-border-input tw-rounded-md tw-bg-background tw-text-sm"
              />
              <Button onClick={applyCharacterSettings} disabled={!presetName.trim()}>
                添加人设
              </Button>
            </div>
            {/* 添加分隔线 */}
            <div className="tw-border-b tw-border-blue-400/50 tw-pt-2"></div>

            <DynamicTraitEditor
              traits={settings.systemPrompts?.activeTraits || {}}
              onTraitsChange={handleTraitsChange}
              updateSystemPrompts={updateSystemPrompts}
              selectedValues={settings.systemPrompts?.selectedValues || {}}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {/* 人设列表 - 移出可折叠区域 */}
      <div className="tw-border-t tw-pt-6">
        <h3 className="tw-text-lg tw-font-medium tw-mb-2">人设列表(展示已配置的系统提示词)</h3>
        {presets.length > 0 ? (
          <div className="tw-space-y-2">
            {/* 缩小间距从space-y-4到space-y-2 */}
            {presets.map((preset) => (
              <div key={preset.id} className="tw-p-3 tw-border tw-rounded">
                <div className="tw-flex tw-flex-col tw-gap-2">
                  <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
                    <div className="tw-flex tw-items-center tw-gap-2">
                      <input
                        type="radio"
                        checked={preset.isActive}
                        onChange={() => handleSelectPreset(preset.id)}
                        className="tw-h-4 tw-w-4"
                      />
                      <span className="tw-font-medium">{preset.name}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleDeletePreset(preset.id)}>
                      <Trash2 className="tw-h-4 tw-w-4" />
                    </Button>
                  </div>
                  {/* 将文本框放在同一行并缩小高度 */}
                  <textarea
                    value={preset.prompt}
                    onChange={(e) => handleUpdatePresetPrompt(preset.id, e.target.value)}
                    className="tw-w-full tw-h-16 tw-p-2 tw-border tw-rounded"
                    placeholder="Character prompt..."
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="tw-text-muted-foreground">尚未创建任何人设,请在调试板进行配置。</div>
        )}
      </div>
    </div>
  );
}

// 修改 DynamicTraitEditor 组件
const DynamicTraitEditor: React.FC<DynamicTraitEditorProps> = ({
  traits,
  onTraitsChange,
  updateSystemPrompts,
  selectedValues, // 直接使用从 props 传入的值
}) => {
  const settings = useSettingsValue();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const checkedItems = settings.systemPrompts?.checkedItems || {};
  const [order, setOrder] = useState<string[]>(
    settings.systemPrompts?.traitOrder || Object.keys(traits) // 安全回退
  );

  // 1. 修改状态定义
  const [editingState, setEditingState] = useState<{
    key: string;
    mode: "add" | "edit" | null;
    value: string;
  }>({
    key: "",
    mode: null, // null 表示不在编辑状态
    value: "",
  });

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const currentKeys = Object.keys(traits);
    setOrder((prev) => {
      // 保留现有顺序，添加新key到末尾，移除不存在的key
      return [
        ...prev.filter((key) => currentKeys.includes(key)),
        ...currentKeys.filter((key) => !prev.includes(key)),
      ];
    });
  }, [traits]); // 依赖traits的变化

  // 替换原来的 editingState 定义
  const [activeAddButton, setActiveAddButton] = useState<string | null>(null);
  const [activeEditButton, setActiveEditButton] = useState<string | null>(null);
  // 2. 合并点击处理函数
  // 修改 startEditing 函数
  const startEditing = (mode: "add" | "edit", key: string, initialValue = "") => {
    if (mode === "add") {
      if (activeAddButton === key) {
        setActiveAddButton(null); // 关闭新增文本框
        setEditingState({ key: "", mode: null, value: "" });
        return;
      }
      setActiveAddButton(key);
      setActiveEditButton(null); // 确保编辑按钮关闭
    } else {
      if (activeEditButton === key) {
        setActiveEditButton(null); // 关闭编辑文本框
        setEditingState({ key: "", mode: null, value: "" });
        return;
      }
      setActiveEditButton(key);
      setActiveAddButton(null); // 确保新增按钮关闭
    }

    setEditingState({
      key,
      mode,
      value: mode === "edit" ? selectedValues[key] || initialValue : initialValue,
    });
  };

  // 3. 合并保存处理函数
  const handleSave = () => {
    if (!editingState.key || !editingState.value.trim()) return;

    const { key, value, mode } = editingState;
    const currentValues = traits[key]?.split("|") || [];

    if (mode === "add") {
      // 添加新值
      const updatedTraits = {
        ...traits,
        [key]: [...currentValues, value.trim()].join("|"),
      };

      onTraitsChange(updatedTraits);
      updateSystemPrompts({
        selectedValues: {
          ...selectedValues,
          [key]: value.trim(), // 选中新添加的值
        },
        activeTraits: updatedTraits,
      });
    } else {
      // 编辑现有值
      const selectedValue = selectedValues[key];
      const newValues = currentValues.map((v) => (v === selectedValue ? value.trim() : v));

      const updatedTraits = {
        ...traits,
        [key]: newValues.join("|"),
      };

      onTraitsChange(updatedTraits);
      updateSystemPrompts({
        selectedValues: {
          ...selectedValues,
          [key]: value.trim(), // 更新选中值
        },
        activeTraits: updatedTraits,
      });
    }

    // 保存后重置所有按钮状态
    setActiveAddButton(null);
    setActiveEditButton(null);
    setEditingState({ key: "", mode: null, value: "" });
  };

  const handleCancel = () => {
    setActiveAddButton(null);
    setActiveEditButton(null);
    setEditingState({ key: "", mode: null, value: "" });
  };

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
        const updatedTraits = {
          ...traits,
          [key]: newValues.join("|"),
        };
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
          // 确保更新 traits 状态
          activeTraits: updatedTraits,
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
          // 确保更新 traits 状态
          activeTraits: newTraits,
        });
      }
    }
  };

  const handleAddTrait = (key: string, value: string = "(空值)") => {
    if (!key.trim()) return;

    // 更新 traits 数据
    const currentValues = value.trim() === "" ? ["(空值)"] : [value.trim()];

    const updatedTraits = {
      ...traits,
      [key]: currentValues.join("|"),
    };

    // 更新order，将新key添加到末尾
    const newOrder = [...order, key];

    // 修改：仅更新新添加特征的 selectedValues 和 checkedItems，保留其他特征的状态
    updateSystemPrompts({
      activeTraits: updatedTraits,
      selectedValues: {
        ...selectedValues, // 保留现有的 selectedValues
        [key]: currentValues[0], // 只更新新特征的 selectedValue
      },
      checkedItems: {
        ...checkedItems, // 保留现有的 checkedItems
        [key]: true, // 只更新新特征的 checkedItems
      },
      traitOrder: newOrder,
    });

    // 通知父组件
    onTraitsChange(updatedTraits);
    setNewKey("");
    setNewValue("");
    setError(null); // 成功添加后清除错误
  };

  const moveTraitUp = (key: string) => {
    const index = order.indexOf(key);
    if (index <= 0) return;

    const newOrder = [...order];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setOrder(newOrder);

    // 保存排序到设置
    updateSystemPrompts({
      traitOrder: newOrder,
    });
  };

  const moveTraitDown = (key: string) => {
    const index = order.indexOf(key);
    // 修改条件判断，明确最后一项不应有任何操作
    if (index === -1 || index >= order.length - 1) return;

    const newOrder = [...order];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setOrder(newOrder);
    // 保存排序到设置
    updateSystemPrompts({
      traitOrder: newOrder,
    });
  };

  return (
    <div className="tw-space-y-4">
      {order.map((key) => {
        const value = traits[key];
        if (!value) return null; // 跳过不存在的key
        const values = value.split("|");
        return (
          <div key={key} className="tw-space-y-2">
            <div className="tw-flex tw-items-center tw-gap-2">
              {/* 新增排序按钮 */}
              <div className="tw-flex tw-flex-col tw-gap-1">
                <Button variant="ghost" size="sm" onClick={() => moveTraitUp(key)}>
                  <ChevronUp className="tw-h-3 tw-w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => moveTraitDown(key)}>
                  <ChevronDown className="tw-h-3 tw-w-3" />
                </Button>
              </div>
              <input
                type="checkbox"
                checked={checkedItems[key] || false}
                onChange={(e) => handleCheckboxChange(key, e.target.checked)}
                className="tw-h-4 tw-w-4"
              />
              <span className="tw-font-medium tw-inline-block tw-w-[100px] tw-truncate" title={key}>
                {key} :
              </span>
              {/* 调整后的下拉框 */}
              <select
                value={selectedValues[key] || ""}
                onChange={(e) => handleValueSelectChange(key, e.target.value)}
                className="tw-flex-1 tw-p-2 tw-border tw-rounded tw-max-w-xs" // 使用 max-w-xs 代替固定宽度
                style={{
                  textOverflow: "ellipsis",
                  maxWidth: "400px", // 增加最大宽度
                  paddingTop: "6px", // 增加上内边距
                  paddingBottom: "6px", // 增加下内边距
                  lineHeight: "1.5", // 可选：增加行高以提升垂直间距
                }}
                title={selectedValues[key] || ""}
              >
                {values.map((v) => (
                  <option
                    key={v}
                    value={v}
                    title={v}
                    style={{
                      maxWidth: "400px", // 同步增加选项最大宽度
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      padding: "8px 0",
                    }}
                  >
                    {/* // 显示更多字符(50) */}
                    {v.length > 50 ? `${v.substring(0, 50)}...` : v}
                  </option>
                ))}
              </select>

              {/* 新增按钮 */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEditing("add", key)}
                className={`tw-h-8 tw-w-8 tw-p-0 ${
                  activeAddButton === key
                    ? "tw-bg-[var(--interactive-accent)] tw-text-[var(--text-on-accent)]"
                    : ""
                }`}
              >
                <Plus className="tw-h-4 tw-w-4" />
              </Button>

              {/* 编辑按钮 */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEditing("edit", key, selectedValues[key])}
                className={`tw-h-8 tw-w-8 tw-p-0 ${
                  activeEditButton === key
                    ? "tw-bg-[var(--interactive-accent)] tw-text-[var(--text-on-accent)]"
                    : ""
                }`}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
              </Button>

              <Button variant="ghost" size="sm" onClick={() => handleRemoveValue(key)}>
                <Trash2 className="tw-h-4 tw-w-4" />
              </Button>
            </div>
            {/* 编辑区域 */}
            {editingState.mode && editingState.key === key && (
              <div className="tw-ml-10 tw-pl-2 tw-border-l-2 tw-border-blue-200">
                <textarea
                  ref={(el) => {
                    if (el) {
                      // 初次渲染时立即计算并设置高度
                      el.style.height = "auto";
                      el.style.height = `${Math.max(el.scrollHeight, 80)}px`;
                    }
                  }}
                  value={editingState.value}
                  onChange={(e) => {
                    setEditingState((prev) => ({
                      ...prev,
                      value: e.target.value,
                    }));
                    // 自动调整高度
                    e.target.style.height = "auto";
                    e.target.style.height = e.target.scrollHeight + "px";
                  }}
                  className="tw-w-full tw-min-w-[300px] tw-max-w-[650px] tw-p-2 tw-border tw-rounded"
                  style={{
                    minHeight: "80px",
                    resize: "none", // 禁止手动调整
                    overflow: "hidden", // 隐藏滚动条
                  }}
                />
                <div className="tw-flex tw-gap-2 tw-mt-2">
                  <Button onClick={handleSave}>保存</Button>
                  <Button variant="secondary" onClick={handleCancel}>
                    取消
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 添加新特征的输入区域 */}
      <div className="tw-border-t tw-border-border tw-pt-4">
        <div className="tw-flex tw-gap-2 tw-items-start">
          {/* 标签名称输入框容器 */}
          <div className="tw-relative tw-w-[180px]">
            {/* 添加 relative 定位 */}
            <input
              placeholder="*标签名称 (如: 角色)"
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                setError(null);
              }}
              className={`tw-w-full tw-p-2 tw-h-8 tw-border ${
                error ? "tw-border-destructive" : "tw-border-input"
              } tw-rounded-md tw-bg-background tw-text-sm focus:tw-ring-2 focus:tw-ring-ring`}
            />
            {/* 绝对定位的错误提示 */}
            {error && (
              <p className="tw-text-destructive tw-text-xs tw-mt-1 tw-absolute tw-left-0 tw-top-full tw-font-medium">
                {error}
              </p>
            )}
          </div>
          {/* 标签内容输入框 - 保持固定高度 */}
          <input
            placeholder="标签内容 (如: 哲学家)，默认为空值"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="tw-flex-1 tw-p-2 tw-h-8 tw-border tw-border-input tw-rounded-md tw-bg-background tw-text-sm focus:tw-ring-2 focus:tw-ring-ring"
          />
          {/* 新增标签按钮 - 保持固定高度 */}
          <Button
            variant="secondary"
            className="tw-h-8" /* 添加固定高度与输入框对齐 */
            onClick={() => {
              if (traits[newKey]) {
                setError("已有相同标签名称，请勿重复添加");
                return;
              }
              const valueToAdd = newValue.trim() === "" ? "(空值)" : newValue;
              handleAddTrait(newKey, valueToAdd);
            }}
            disabled={!newKey.trim()}
          >
            <Plus className="tw-h-4 tw-w-4" />
            新增标签
          </Button>
        </div>
      </div>
    </div>
  );
};
