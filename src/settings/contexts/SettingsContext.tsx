import { BUILTIN_CHAT_MODELS, BUILTIN_EMBEDDING_MODELS, DEFAULT_SETTINGS } from "@/constants";
import CopilotPlugin from "@/main";
import { CopilotSettings } from "@/settings/SettingsPage";
import React, { createContext, useCallback, useContext, useState } from "react";

interface SettingsContextType {
  settings: CopilotSettings;
  updateSettings: (newSettings: Partial<CopilotSettings>) => void;
  saveSettings: () => Promise<void>;
  resetSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{
  plugin: CopilotPlugin;
  reloadPlugin: () => Promise<void>;
  children: React.ReactNode;
}> = ({ plugin, reloadPlugin, children }) => {
  const [settings, setSettings] = useState<CopilotSettings>(plugin.settings);

  const updateSettings = useCallback(
    async (newSettings: Partial<CopilotSettings>) => {
      const updatedSettings = { ...settings, ...newSettings };
      setSettings(updatedSettings);
      plugin.settings = updatedSettings;
      await plugin.saveSettings();
      if (newSettings.activeModels) {
        plugin.chainManager.chatModelManager.buildModelMap(updatedSettings.activeModels);
      }
    },
    [plugin, settings]
  );

  const saveSettings = useCallback(async () => {
    await plugin.saveSettings();
    await reloadPlugin();
  }, [plugin, reloadPlugin]);

  const resetSettings = useCallback(async () => {
    const defaultSettingsWithBuiltIns = {
      ...DEFAULT_SETTINGS,
      activeModels: BUILTIN_CHAT_MODELS.map((model) => ({ ...model, enabled: true })),
      activeEmbeddingModels: BUILTIN_EMBEDDING_MODELS.map((model) => ({ ...model, enabled: true })),
    };
    plugin.settings = defaultSettingsWithBuiltIns;
    setSettings(defaultSettingsWithBuiltIns);
    await plugin.saveSettings();
    await reloadPlugin();
  }, [plugin, reloadPlugin]);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, saveSettings, resetSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettingsContext = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettingsContext must be used within a SettingsProvider");
  }
  return context;
};
