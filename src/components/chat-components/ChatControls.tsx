import React from "react";
import {
  Download,
  MoreHorizontal,
  Sparkles,
  FileText,
  RefreshCw,
  MessageCirclePlus,
  ChevronDown,
  SquareArrowOutUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@radix-ui/react-dropdown-menu";
import { DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { updateSetting, useSettingsValue } from "@/settings/model";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useChainType } from "@/aiParams";
import { ChainType } from "@/chainFactory";
import { Notice } from "obsidian";
import VectorStoreManager from "@/search/vectorStoreManager";
import { navigateToPlusPage, useIsPlusUser } from "@/plusUtils";
import { PLUS_UTM_MEDIUMS } from "@/constants";

export async function refreshVaultIndex() {
  try {
    await VectorStoreManager.getInstance().indexVaultToVectorStore();
    new Notice("Vault index refreshed.");
  } catch (error) {
    console.error("Error refreshing vault index:", error);
    new Notice("Failed to refresh vault index. Check console for details.");
  }
}

interface ChatControlsProps {
  onNewChat: () => void;
  onSaveAsNote: () => void;
}

export function ChatControls({ onNewChat, onSaveAsNote }: ChatControlsProps) {
  const settings = useSettingsValue();
  const [selectedChain, setSelectedChain] = useChainType();
  const isPlusUser = useIsPlusUser();

  // 获取人设列表
  const presets = settings.systemPrompts?.presets || [];

  return (
    <div className="w-full py-1 flex justify-between items-center px-1">
      <div className="flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="ml-1">
              {selectedChain === ChainType.LLM_CHAIN && "chat"}
              {selectedChain === ChainType.VAULT_QA_CHAIN && "vault QA"}
              {selectedChain === ChainType.COPILOT_PLUS_CHAIN && (
                <div className="flex items-center gap-1">
                  <Sparkles className="size-4" />
                  copilot plus (beta)
                </div>
              )}
              <ChevronDown className="size-5 mt-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.LLM_CHAIN)}>
              chat
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.VAULT_QA_CHAIN)}>
              vault QA
            </DropdownMenuItem>
            {isPlusUser ? (
              <DropdownMenuItem onSelect={() => setSelectedChain(ChainType.COPILOT_PLUS_CHAIN)}>
                <div className="flex items-center gap-1">
                  <Sparkles className="size-4" />
                  copilot plus (beta)
                </div>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onSelect={() => {
                  navigateToPlusPage(PLUS_UTM_MEDIUMS.CHAT_MODE_SELECT);
                }}
              >
                copilot plus (beta)
                <SquareArrowOutUpRight className="size-3" />
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* // 在return语句中添加人设下拉框（与模式选择下拉框并列） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="fit" className="ml-1">
              {settings.systemPrompts?.presets?.find((p) => p.isActive)?.name || "选择人设"}
              <ChevronDown className="size-5 mt-0.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {presets.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onSelect={() => {
                  // 更新选中的人设
                  const updatedPresets = presets.map((p) => ({
                    ...p,
                    isActive: p.id === preset.id,
                  }));

                  // 更新系统设置
                  updateSetting("systemPrompts", {
                    ...settings.systemPrompts,
                    presets: updatedPresets,
                    default: preset.prompt, // 将选中人设的提示词设为默认
                  });

                  // 同时更新用户系统提示词
                  updateSetting("userSystemPrompt", preset.prompt);
                }}
              >
                {preset.name}
                {preset.isActive && <span className="ml-2 text-green-500">✓</span>}
              </DropdownMenuItem>
            ))}
            {presets.length === 0 && <DropdownMenuItem disabled>尚未创建任何人设</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost2" size="icon" title="New Chat" onClick={onNewChat}>
              <MessageCirclePlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New Chat</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost2" size="icon" title="Save Chat as Note" onClick={onSaveAsNote}>
              <Download className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Save Chat as Note</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost2" size="icon" title="Advanced Settings">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* 新增自动衍生问题开关 */}
            <DropdownMenuItem
              className="flex justify-between"
              onSelect={(e) => {
                e.preventDefault();
                updateSetting("promptEnhancements", {
                  ...settings.promptEnhancements,
                  autoFollowUp: {
                    enabled: !settings.promptEnhancements?.autoFollowUp?.enabled,
                    prompt: settings.promptEnhancements?.autoFollowUp?.prompt || "",
                  },
                });
              }}
            >
              <div className="flex items-center gap-2">
                <MessageCirclePlus className="size-4" />
                自动衍生问题
              </div>
              <SettingSwitch
                checked={settings.promptEnhancements?.autoFollowUp?.enabled || false}
              />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex justify-between"
              onSelect={(e) => {
                e.preventDefault();
                updateSetting("showSuggestedPrompts", !settings.showSuggestedPrompts);
              }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="size-4" />
                Suggested Prompt
              </div>
              <SettingSwitch checked={settings.showSuggestedPrompts} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex justify-between"
              onSelect={(e) => {
                e.preventDefault();
                updateSetting("showRelevantNotes", !settings.showRelevantNotes);
              }}
            >
              <div className="flex items-center gap-2">
                <FileText className="size-4" />
                Relevant Note
              </div>
              <SettingSwitch checked={settings.showRelevantNotes} />
            </DropdownMenuItem>
            <DropdownMenuItem
              className="flex items-center gap-2"
              onSelect={() => refreshVaultIndex()}
            >
              <RefreshCw className="size-4" />
              Refresh Vault Index
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
