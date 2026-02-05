import { DEFAULT_MODEL_SETTING, ReasoningEffort, Verbosity } from "@/constants";

/**
 * Model parameters configuration interface
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
 * Reasoning effort options configuration
 */
export const REASONING_EFFORT_OPTIONS = [
  { value: ReasoningEffort.MINIMAL, label: "Minimal" },
  { value: ReasoningEffort.LOW, label: "Low" },
  { value: ReasoningEffort.MEDIUM, label: "Medium" },
  { value: ReasoningEffort.HIGH, label: "High" },
  { value: ReasoningEffort.XHIGH, label: "Extra High" },
];

/**
 * Verbosity options configuration
 */
export const VERBOSITY_OPTIONS = [
  { value: Verbosity.LOW, label: "Low" },
  { value: Verbosity.MEDIUM, label: "Medium" },
  { value: Verbosity.HIGH, label: "High" },
];

/**
 * Get the default reasoning effort value
 */
export function getDefaultReasoningEffort(): ReasoningEffort {
  return DEFAULT_MODEL_SETTING.REASONING_EFFORT;
}

/**
 * Get the default verbosity value
 */
export function getDefaultVerbosity(): Verbosity {
  return DEFAULT_MODEL_SETTING.VERBOSITY;
}
