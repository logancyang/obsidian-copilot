import { DEFAULT_MODEL_SETTING, ReasoningEffort, Verbosity } from "@/constants";

/**
 * 模型参数配置接口
 */
export interface ModelParams {
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  verbosity?: Verbosity;
}

/**
 * Reasoning effort 选项配置
 */
export const REASONING_EFFORT_OPTIONS = [
  { value: ReasoningEffort.MINIMAL, label: "Minimal" },
  { value: ReasoningEffort.LOW, label: "Low" },
  { value: ReasoningEffort.MEDIUM, label: "Medium" },
  { value: ReasoningEffort.HIGH, label: "High" },
];

/**
 * Verbosity 选项配置
 */
export const VERBOSITY_OPTIONS = [
  { value: Verbosity.LOW, label: "Low" },
  { value: Verbosity.MEDIUM, label: "Medium" },
  { value: Verbosity.HIGH, label: "High" },
];

/**
 * 获取 reasoningEffort 的默认值
 */
export function getDefaultReasoningEffort(): ReasoningEffort {
  return DEFAULT_MODEL_SETTING.REASONING_EFFORT;
}

/**
 * 获取 verbosity 的默认值
 */
export function getDefaultVerbosity(): Verbosity {
  return DEFAULT_MODEL_SETTING.VERBOSITY;
}
