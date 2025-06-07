import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CopilotSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
    <div className="space-y-4 border border-red-500">
      {/* 可折叠的高级管理区域 - 仅保留人设调试板 */}
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-muted-foreground text-base">
              {isExpanded ? (
                <>
                  <ChevronUp className="mr-2 h-4 w-4" />
                  隐藏调试板
                </>
              ) : (
                <>
                  <ChevronDown className="mr-2 h-4 w-4" />
                  打开调试板
                </>
              )}
            </Button>
          </CollapsibleTrigger>
        </div>

        {/* 修改 CollapsibleContent 部分的代码 */}
        <CollapsibleContent className="space-y-2">
          {/* 人设调试板 */}
          <div className="border-t pt-2">
            <h3 className="text-lg font-medium mb-2">人设调试板</h3>

            {/* 修改应用按钮区域 - 将添加人设按钮移到前面 */}
            <div className="flex gap-2 items-center mb-4">
              {" "}
              {/* 添加 mb-4 下边距 */}
              <input
                placeholder="人设名称（用于人设列表中标识系统提示词）"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="w-[300px] p-2 border rounded"
              />
              <Button onClick={applyCharacterSettings} disabled={!presetName.trim()}>
                添加人设
              </Button>
            </div>
            {/* 添加分隔线 */}
            <div className="border-b border-blue-400/50 pt-2"></div>

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
      <div className="border-t pt-6">
        <h3 className="text-lg font-medium mb-2">人设列表(展示已配置的系统提示词)</h3>
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
          <div className="text-muted-foreground">尚未创建任何人设,请在调试板进行配置。</div>
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
  const [dialogState, setDialogState] = useState<{
    mode: "add" | "edit";
    key: string;
    value: string;
    isOpen: boolean;
  }>({
    mode: "add",
    key: "",
    value: "",
    isOpen: false,
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

  // 2. 合并点击处理函数
  const handleDialogOpen = (mode: "add" | "edit", key: string, initialValue = "") => {
    setDialogState({
      mode,
      key,
      value: initialValue,
      isOpen: true,
    });
  };

  // 3. 合并保存处理函数
  const handleSaveValue = () => {
    const { mode, key, value } = dialogState;
    if (!key || !value.trim()) return;

    if (mode === "add") {
      // 处理添加新值逻辑
      const currentValues = traits[key]?.split("|") || [];
      currentValues.push(value.trim());
      const updatedTraits = {
        ...traits,
        [key]: currentValues.join("|"),
      };

      onTraitsChange(updatedTraits);

      updateSystemPrompts({
        selectedValues: {
          ...selectedValues,
          [key]: value.trim(),
        },
        activeTraits: updatedTraits,
      });
    } else {
      // 修改编辑逻辑：删除旧值，添加新值
      const currentValues = traits[key]?.split("|") || [];
      const selectedValue = selectedValues[key];

      // 1. 过滤掉要编辑的原始值
      const filteredValues = currentValues.filter((v) => v !== selectedValue);

      // 2. 添加编辑后的新值
      const updatedValues = [...filteredValues, value.trim()];

      const updatedTraits = {
        ...traits,
        [key]: updatedValues.join("|"),
      };

      onTraitsChange(updatedTraits);
      // 3. 更新状态，确保选中新编辑的值
      updateSystemPrompts({
        selectedValues: {
          ...selectedValues,
          [key]: value.trim(), // 强制选中新编辑的值
        },
        activeTraits: updatedTraits,
      });
    }

    setDialogState((prev) => ({ ...prev, isOpen: false, value: "" }));
  };

  // 4. 统一对话框组件
  const renderDialog = () => (
    <Dialog
      open={dialogState.isOpen}
      onOpenChange={(open) => setDialogState((prev) => ({ ...prev, isOpen: open }))}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {dialogState.mode === "add"
              ? `为 ${dialogState.key} 添加新值`
              : `编辑 ${dialogState.key} 的内容`}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <textarea
            placeholder="输入内容"
            value={dialogState.value}
            onChange={(e) => setDialogState((prev) => ({ ...prev, value: e.target.value }))}
            className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            autoFocus
            rows={4}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setDialogState((prev) => ({ ...prev, isOpen: false }))}
            >
              取消
            </Button>
            <Button onClick={handleSaveValue}>保存</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

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
    <div className="space-y-4">
      {/* 加入这行 ↓ */}
      {renderDialog()}
      {order.map((key) => {
        const value = traits[key];
        if (!value) return null; // 跳过不存在的key
        const values = value.split("|");
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center gap-2">
              {/* 新增排序按钮 */}
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="sm" onClick={() => moveTraitUp(key)}>
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => moveTraitDown(key)}>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
              <input
                type="checkbox"
                checked={checkedItems[key] || false}
                onChange={(e) => handleCheckboxChange(key, e.target.checked)}
                className="h-4 w-4"
              />
              <span className="font-medium inline-block w-[100px] truncate" title={key}>
                {key} :
              </span>
              {/* 调整后的下拉框 */}
              <select
                value={selectedValues[key] || ""}
                onChange={(e) => handleValueSelectChange(key, e.target.value)}
                className="flex-1 p-2 border rounded max-w-xs" // 使用 max-w-xs 代替固定宽度
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

              {/* // 修改后的新增按钮和对话框部分 */}
              {/* // 5. 修改按钮调用方式
              // 添加按钮改为: */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDialogOpen("add", key)}
                className="h-8 w-8 p-0"
              >
                <Plus className="h-4 w-4" />
              </Button>

              {/* // 编辑按钮改为: */}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDialogOpen("edit", key, selectedValues[key] || "")}
                className="h-8 w-8 p-0"
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
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        );
      })}

      {/* 添加新特征的输入区域 */}
      <div className="border-t pt-4">
        <div className="flex gap-2 items-start">
          {" "}
          {/* 添加 items-start 对齐 */}
          {/* 标签名称输入框容器 */}
          <div className="relative w-[180px]">
            {" "}
            {/* 添加 relative 定位 */}
            <input
              placeholder="*标签名称 (如: 角色)"
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                setError(null);
              }}
              className={`w-full p-2 border rounded ${error ? "border-red-500" : ""}`}
            />
            {/* 绝对定位的错误提示 */}
            {error && (
              <p className="text-red-500 text-xs mt-1 absolute left-0 top-full font-medium">
                {error}
              </p>
            )}
          </div>
          {/* 标签内容输入框 - 保持固定高度 */}
          <input
            placeholder="标签内容 (如: 哲学家)，默认为空值"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            className="flex-1 p-2 border rounded h-[32px]" /* 添加固定高度 h-[42px] */
          />
          {/* 新增标签按钮 - 保持固定高度 */}
          <Button
            variant="secondary"
            className="h-[32px]" /* 添加固定高度与输入框对齐 */
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
            <Plus className="h-4 w-4" />
            新增标签
          </Button>
        </div>
      </div>
    </div>
  );
};
