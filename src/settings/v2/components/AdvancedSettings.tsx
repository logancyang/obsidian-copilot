import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { ObsidianNativeSelect } from "@/components/ui/obsidian-native-select";
import { ConfigurationSharing } from "@/components/setup-uri/ConfigurationSharing";
import { logFileManager } from "@/logFileManager";
import { flushRecordedPromptPayloadToLog } from "@/LLMProviders/chainRunner/utils/promptPayloadRecorder";
import { KeychainService } from "@/services/keychainService";
import {
  canClearDiskSecrets,
  clearDiskSecrets,
  refreshRawDataSnapshot,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { logError } from "@/logger";
import { type CopilotSettings, setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { ArrowUpRight, Plus, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Notice } from "obsidian";
import React, { useCallback, useState } from "react";
import { getPromptFilePath, SystemPromptAddModal } from "@/system-prompts";
import { useSystemPrompts } from "@/system-prompts/state";

export const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();
  const prompts = useSystemPrompts();
  const [forgetting, setForgetting] = useState(false);
  const [clearingOldCopies, setClearingOldCopies] = useState(false);

  const keychainAvailable = KeychainService.getInstance().isAvailable();
  const showClearOldCopies = canClearDiskSecrets(settings);

  // Check if the default system prompt exists in the current prompts list
  const defaultPromptExists = prompts.some(
    (prompt) => prompt.title === settings.defaultSystemPromptTitle
  );

  const displayValue = defaultPromptExists ? settings.defaultSystemPromptTitle : "";

  const handleSelectChange = (value: string) => {
    updateSetting("defaultSystemPromptTitle", value);
  };

  const handleOpenSourceFile = () => {
    if (!displayValue) return;
    const filePath = getPromptFilePath(displayValue);
    (app as any).setting.close();
    app.workspace.openLinkText(filePath, "", true);
  };

  const handleAddPrompt = () => {
    const modal = new SystemPromptAddModal(app, prompts);
    modal.open();
  };

  const handleForgetAllSecrets = useCallback(async () => {
    if (forgetting) return;

    // Reason: double-confirm destructive action via project ConfirmModal
    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        "This will remove all API keys for this vault from the OS Keychain, " +
          "data.json, and memory. You will need to re-enter them.",
        "\u26A0\uFE0F Forget All Secrets",
        "Remove",
        "Cancel",
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setForgetting(true);
    try {
      const keychain = KeychainService.getInstance();
      const saveData = async (data: any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const plugins = (app as any).plugins;
        const copilotPlugin = plugins.getPlugin("copilot");
        if (!copilotPlugin) throw new Error("Copilot plugin not found");
        await copilotPlugin.saveData(data);
      };

      // Reason: run inside the persistence queue to prevent interleaving
      // with normal saves that could restore old secrets.
      let skipSuppress = false;
      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(
          saveData,
          refreshRawDataSnapshot,
          (nextSettings) => {
            // Reason: when disk save succeeded, suppress the subscriber persist
            // to avoid double-write. When it failed, let the subscriber retry
            // so the stripped state reaches data.json on the next save cycle.
            if (!skipSuppress) {
              suppressNextPersistOnce();
            }
            setSettings(nextSettings);
          },
          () => {
            skipSuppress = true;
          }
        )
      );
    } catch (error) {
      logError("Failed to forget secrets.", error);
      new Notice("Failed to remove API keys. Please try again.");
    } finally {
      setForgetting(false);
    }
  }, [forgetting]);

  /** Clear old secret copies from data.json only (keychain stays intact). */
  const handleClearOldCopies = useCallback(async () => {
    if (clearingOldCopies) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        "This will remove old API key copies from data.json. " +
          "Your keys remain safe in the OS Keychain.",
        "Remove from data.json",
        "Remove",
        "Cancel",
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setClearingOldCopies(true);
    try {
      const saveData = async (data: CopilotSettings) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const plugins = (app as any).plugins;
        const copilotPlugin = plugins.getPlugin("copilot");
        if (!copilotPlugin) throw new Error("Copilot plugin not found");
        await copilotPlugin.saveData(data);
      };
      await clearDiskSecrets(saveData);
      new Notice("Old copies removed from data.json.");
    } catch (error) {
      logError("Failed to clear old copies.", error);
      new Notice("Failed to clear old copies. Please try again.");
    } finally {
      setClearingOldCopies(false);
    }
  }, [clearingOldCopies]);

  return (
    <div className="tw-space-y-4">
      {/* User System Prompt Section */}
      <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
        <div className="tw-text-xl tw-font-bold">User System Prompt</div>

        <SettingItem
          type="custom"
          title="Default System Prompt"
          description="Customize the system prompt for all messages, may result in unexpected behavior!"
        >
          <div className="tw-flex tw-items-center tw-gap-2">
            <ObsidianNativeSelect
              value={displayValue}
              onChange={(e) => handleSelectChange(e.target.value)}
              options={[
                { label: "None (use built-in prompt)", value: "" },
                ...prompts.map((prompt) => ({
                  label:
                    prompt.title === settings.defaultSystemPromptTitle
                      ? `${prompt.title} (Default)`
                      : prompt.title,
                  value: prompt.title,
                })),
              ]}
              containerClassName="tw-flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleOpenSourceFile}
              className="tw-size-5 tw-shrink-0 tw-p-0"
              title="Open the source file"
              disabled={!displayValue}
            >
              <ArrowUpRight className="tw-size-5" />
            </Button>
            <Button variant="default" size="icon" onClick={handleAddPrompt} title="Add new prompt">
              <Plus className="tw-size-4" />
            </Button>
          </div>
        </SettingItem>

        <SettingItem
          type="text"
          title="System Prompts Folder Name"
          description="Folder where system prompts are stored."
          value={settings.userSystemPromptsFolder}
          onChange={(value) => updateSetting("userSystemPromptsFolder", value)}
          placeholder="copilot/system-prompts"
        />
      </section>

      {/* Configuration Sharing Section */}
      <ConfigurationSharing />

      {/* Others Section */}
      <section className="tw-space-y-4 tw-rounded-lg tw-border tw-p-4">
        <div className="tw-text-xl tw-font-bold">Others</div>

        {/* Keychain status badge */}
        <SettingItem
          type="custom"
          title="API Key Storage"
          description={
            keychainAvailable
              ? "API keys are stored in your operating system's secure Keychain."
              : "OS Keychain is unavailable. Keys are stored in data.json (plaintext)."
          }
        >
          <div className="tw-flex tw-flex-col tw-items-start tw-gap-3 sm:tw-items-end">
            {keychainAvailable ? (
              <div className="tw-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-bg-success tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-success">
                <ShieldCheck className="tw-size-4" />
                OS Keychain
              </div>
            ) : (
              <div className="tw-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-bg-error tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-warning">
                <ShieldAlert className="tw-size-4" />
                Unavailable
              </div>
            )}
            {showClearOldCopies && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleClearOldCopies}
                disabled={clearingOldCopies}
              >
                {clearingOldCopies ? "Removing..." : "Remove from data.json"}
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={handleForgetAllSecrets}
              disabled={forgetting}
              className="tw-gap-1.5"
            >
              <Trash2 className="tw-size-4" />
              {forgetting ? "Deleting..." : "Delete All API Keys"}
            </Button>
          </div>
        </SettingItem>

        <SettingItem
          type="switch"
          title="Debug Mode"
          description="Debug mode will log some debug message to the console."
          checked={settings.debug}
          onCheckedChange={(checked) => updateSetting("debug", checked)}
        />

        <SettingItem
          type="custom"
          title="Create Log File"
          description={`Open the Copilot log file (${logFileManager.getLogPath()}) for easy sharing when reporting issues.`}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              await flushRecordedPromptPayloadToLog();
              await logFileManager.flush();
              await logFileManager.openLogFile();
            }}
          >
            Create Log File
          </Button>
        </SettingItem>
      </section>
    </div>
  );
};
