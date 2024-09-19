import { CopilotSettings } from "@/settings/SettingsPage";

export interface PromptUsageStrategy {
  recordUsage: (promptTitle: string) => PromptUsageStrategy;

  updateUsage: (oldTitle: string, newTitle: string) => PromptUsageStrategy;

  removeUnusedPrompts: (existingPromptTitles: Array<string>) => PromptUsageStrategy;

  compare: (aKey: string, bKey: string) => number;

  save: () => Promise<void>;
}

export class TimestampUsageStrategy implements PromptUsageStrategy {
  private usageData: Record<string, number> = {};

  constructor(
    private settings: CopilotSettings,
    private saveSettings: () => Promise<void>
  ) {
    this.usageData = { ...settings.promptUsageTimestamps };
  }

  recordUsage(promptTitle: string): PromptUsageStrategy {
    this.usageData[promptTitle] = Date.now();
    return this;
  }

  updateUsage(oldTitle: string, newTitle: string): PromptUsageStrategy {
    this.usageData[newTitle] = this.usageData[oldTitle];
    delete this.usageData[oldTitle];
    return this;
  }

  removeUnusedPrompts(existingPromptTitles: Array<string>): PromptUsageStrategy {
    for (const key in this.usageData) {
      if (!existingPromptTitles.contains(key)) {
        delete this.usageData[key];
      }
    }
    return this;
  }

  compare(aKey: string, bKey: string): number {
    return (this.usageData[aKey] || 0) - (this.usageData[bKey] || 0);
  }

  async save(): Promise<void> {
    this.settings.promptUsageTimestamps = { ...this.usageData };
    await this.saveSettings();
  }
}
