import { Modal, PluginSettingTab, SettingTab } from "obsidian";

interface AppSetting extends Modal {
  openTab(tab: SettingTab): void;

  openTabById(id: string): any;

  activeTab: SettingTab | null;
  pluginTabs: PluginSettingTab[];
}

declare module "obsidian" {
  interface App {
    setting: AppSetting;
    plugins: {
      manifests: Record<string, PluginManifest>;
      plugins: {
        dataview?: Plugin & {
          api: any;
        };
        quickadd?: Plugin & {
          api: any;
        };
        ["obsidian-hover-editor"]?: Plugin & {
          activePopovers: (HoverPopover & {
            toggleMinimized(): void;
            togglePin(value?: boolean): void;
          })[];
          spawnPopover(initiatingEl?: HTMLElement, onShowCallback?: () => unknown): WorkspaceLeaf;
        };
        ["obsidian-tts"]?: Plugin & {
          say(text: string, languageCode?: string): Promise<void>;
        };
        [id: string]: Plugin | undefined;
      };
      enabledPlugins: Set<string>;
      /** Whether restricted mode is on */
      isEnabled(): boolean;
    };
  }
}
