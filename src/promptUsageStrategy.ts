import { getSettings, updateSetting } from "@/settings/model";
import { PromptSortStrategy } from "@/types";

export interface PromptUsageStrategy {
  recordUsage: (promptTitle: string) => void;

  updateUsage: (oldTitle: string, newTitle: string) => void;

  removeUnusedPrompts: (existingPromptTitles: Array<string>) => void;

  compare: (aKey: string, bKey: string) => number;
}

export class TimestampUsageStrategy implements PromptUsageStrategy {
  get usageData(): Readonly<Record<string, number>> {
    return getSettings().promptUsageTimestamps;
  }

  recordUsage(promptTitle: string) {
    updateSetting("promptUsageTimestamps", { ...this.usageData, [promptTitle]: Date.now() });
  }

  updateUsage(oldTitle: string, newTitle: string) {
    const newUsageData = { ...this.usageData };
    newUsageData[newTitle] = newUsageData[oldTitle];
    delete newUsageData[oldTitle];
    updateSetting("promptUsageTimestamps", newUsageData);
  }

  removeUnusedPrompts(existingPromptTitles: Array<string>) {
    const newUsageData = { ...this.usageData };
    for (const key of Object.keys(newUsageData)) {
      if (!existingPromptTitles.includes(key)) {
        delete newUsageData[key];
      }
    }
    updateSetting("promptUsageTimestamps", newUsageData);
  }

  compare(aKey: string, bKey: string): number {
    return (this.usageData[aKey] || 0) - (this.usageData[bKey] || 0);
  }
}

export class AlphabeticalSortStrategy implements PromptUsageStrategy {
  get usageData(): Readonly<Record<string, number>> {
    return getSettings().promptUsageTimestamps;
  }

  recordUsage(promptTitle: string) {
    // Alphabetical sorting doesn't need to record usage, but keeping this method for interface consistency
    // Reusing timestamp strategy implementation to maintain state synchronization
    updateSetting("promptUsageTimestamps", { ...this.usageData, [promptTitle]: Date.now() });
  }

  updateUsage(oldTitle: string, newTitle: string) {
    const newUsageData = { ...this.usageData };
    newUsageData[newTitle] = newUsageData[oldTitle];
    delete newUsageData[oldTitle];
    updateSetting("promptUsageTimestamps", newUsageData);
  }

  removeUnusedPrompts(existingPromptTitles: Array<string>) {
    const newUsageData = { ...this.usageData };
    for (const key of Object.keys(newUsageData)) {
      if (!existingPromptTitles.includes(key)) {
        delete newUsageData[key];
      }
    }
    updateSetting("promptUsageTimestamps", newUsageData);
  }

  compare(aKey: string, bKey: string): number {
    return bKey.localeCompare(aKey);
  }
}

export function createPromptUsageStrategy(): PromptUsageStrategy {
  const settings = getSettings();
  const strategy = settings.promptSortStrategy || PromptSortStrategy.TIMESTAMP;

  switch (strategy) {
    case PromptSortStrategy.ALPHABETICAL:
      return new AlphabeticalSortStrategy();
    case PromptSortStrategy.TIMESTAMP:
    default:
      return new TimestampUsageStrategy();
  }
}
